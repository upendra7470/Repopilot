import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleGithubIdentity } from "../github-auth.service.js";
import {
  AlreadyConnectedError,
  connectRepository,
  discoverRepositories,
} from "../github-repos.service.js";
import { GithubApiError } from "../github-provider.js";
import { getDb } from "../../db/index.js";
import { repositories } from "../../db/schema.js";
import { eq } from "drizzle-orm";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    list: [] as Array<Record<string, unknown>>,
    get: null as Record<string, unknown> | null,
    getError: null as GithubApiError | null,
  },
}));

vi.mock("../github-provider.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../github-provider.js")>();
  return {
    ...original,
    listGithubRepositories: vi.fn(async () => mockState.list),
    getGithubRepository: vi.fn(async () => {
      if (mockState.getError) throw mockState.getError;
      if (!mockState.get) throw new original.GithubApiError(404, "missing");
      return mockState.get;
    }),
  };
});

function setupEnv(): void {
  process.env.DATABASE_URL = "postgresql://localhost:5432/repopilot_test";
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.AUTH_SECRET = "test-only-auth-secret-at-least-32-chars!!";
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ghRepo(id: number, owner: string, name: string) {
  return {
    id,
    owner,
    name,
    fullName: `${owner}/${name}`,
    description: `${name} description`,
    isPrivate: false,
    defaultBranch: "main",
    htmlUrl: `https://github.com/${owner}/${name}`,
    archived: false,
    fork: false,
    permissions: { admin: true, push: true, pull: true },
    updatedAt: "2026-09-01T00:00:00Z",
  };
}

async function loginFreshUser() {
  const suffix = uniqueSuffix();
  return handleGithubIdentity(
    {
      githubId: `gh-conn-${suffix}`,
      login: `conn-${suffix}`,
      name: null,
      email: null,
      avatarUrl: null,
    },
    { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
  );
}

describe("GitHub repository connection service", () => {
  beforeEach(() => {
    setupEnv();
    mockState.list = [];
    mockState.get = null;
    mockState.getError = null;
  });

  it("discovers, filters, paginates, and marks connected repos", async () => {
    const login = await loginFreshUser();
    mockState.list = [
      ghRepo(1, "octocat", "alpha"),
      ghRepo(2, "octocat", "beta"),
      ghRepo(3, "other", "gamma"),
    ];

    const all = await discoverRepositories(login.user.id, {});
    expect(all.pagination.total).toBe(3);
    expect(all.data.every((r) => r.connected === false)).toBe(true);

    const filtered = await discoverRepositories(login.user.id, { query: "alp" });
    expect(filtered.pagination.total).toBe(1);
    expect(filtered.data[0].fullName).toBe("octocat/alpha");

    const page = await discoverRepositories(login.user.id, {
      page: 2,
      perPage: 2,
    });
    expect(page.data).toHaveLength(1);
    expect(page.pagination).toMatchObject({ page: 2, perPage: 2, total: 3 });

    // Connect one, then rediscover: flag flips for this user only.
    mockState.get = ghRepo(1, "octocat", "alpha");
    await connectRepository(login.user.id, "octocat", "alpha");
    const rediscovered = await discoverRepositories(login.user.id, {});
    expect(
      rediscovered.data.find((r) => r.fullName === "octocat/alpha")?.connected,
    ).toBe(true);
  });

  it("connects an accessible repository and persists metadata", async () => {
    const login = await loginFreshUser();
    mockState.get = ghRepo(9001, "octocat", "hello-world");

    const record = await connectRepository(login.user.id, "octocat", "hello-world");

    expect(record.fullName).toBe("octocat/hello-world");
    expect(record.githubId).toBe("9001");
    expect(record.connectionStatus).toBe("connected");

    const db = getDb();
    const rows = await db
      .select()
      .from(repositories)
      .where(eq(repositories.githubId, "9001"));
    expect(rows).toHaveLength(1);
    expect(rows[0].htmlUrl).toBe("https://github.com/octocat/hello-world");
  });

  it("rejects duplicate connections with AlreadyConnectedError", async () => {
    const login = await loginFreshUser();
    mockState.get = ghRepo(9002, "octocat", "dup");

    await connectRepository(login.user.id, "octocat", "dup");
    await expect(
      connectRepository(login.user.id, "octocat", "dup"),
    ).rejects.toBeInstanceOf(AlreadyConnectedError);
  });

  it("reuses one canonical row when two users connect the same repo", async () => {
    const userA = await loginFreshUser();
    const userB = await loginFreshUser();
    mockState.get = ghRepo(9003, "shared", "repo");

    const recordA = await connectRepository(userA.user.id, "shared", "repo");
    const recordB = await connectRepository(userB.user.id, "shared", "repo");

    expect(recordB.id).toBe(recordA.id);

    const db = getDb();
    const rows = await db
      .select()
      .from(repositories)
      .where(eq(repositories.githubId, "9003"));
    expect(rows).toHaveLength(1);
  });

  it("refuses repositories the credential cannot access", async () => {
    const login = await loginFreshUser();
    mockState.getError = new GithubApiError(404, "missing");

    await expect(
      connectRepository(login.user.id, "octocat", "nope"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects malformed owner/name without calling GitHub", async () => {
    const login = await loginFreshUser();

    await expect(connectRepository(login.user.id, "bad owner!", "x")).rejects.toMatchObject({
      status: 400,
    });
  });

  it("requires a stored GitHub credential", async () => {
    const { createUser } = await import("../user.service.js");
    const user = await createUser({ login: `nocred-${uniqueSuffix()}` });

    await expect(
      discoverRepositories(user.id, {}),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      connectRepository(user.id, "octocat", "x"),
    ).rejects.toMatchObject({ status: 401 });
  });
});
