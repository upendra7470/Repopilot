import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";
import { GithubApiError } from "../../services/github-provider.js";
import {
  createRepository,
  linkUserRepository,
} from "../../services/repository.service.js";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    authError: null as GithubApiError | null,
  },
}));

vi.mock("../../services/github-provider.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../services/github-provider.js")>();
  const fail = () => {
    if (mockState.authError) throw mockState.authError;
  };
  return {
    ...original,
    fetchGithubRepoMetadata: vi.fn(async () => {
      fail();
      return {
        id: 7001,
        owner: "o",
        name: "r",
        fullName: "o/r",
        description: null,
        isPrivate: false,
        defaultBranch: "main",
        htmlUrl: "https://github.com/o/r",
        archived: false,
        fork: false,
        updatedAt: null,
      };
    }),
    listGithubBranches: vi.fn(async () => {
      fail();
      return [{ name: "main", sha: "a".repeat(40), isProtected: true }];
    }),
    listGithubCommits: vi.fn(async () => {
      fail();
      return [
        {
          sha: "b".repeat(40),
          message: "init",
          author: {
            name: "A",
            email: "a@x.com",
            login: "alice",
            githubId: 1,
            avatarUrl: null,
            date: "2026-09-01T10:00:00Z",
          },
          committer: {
            name: "A",
            email: "a@x.com",
            login: "alice",
            githubId: 1,
            avatarUrl: null,
            date: "2026-09-01T10:00:00Z",
          },
          url: null,
          parents: [],
        },
      ];
    }),
    fetchGithubTree: vi.fn(async () => {
      fail();
      return {
        truncated: false,
        entries: [
          { path: "README.md", sha: "c".repeat(40), type: "blob", size: 10, mode: "100644" },
        ],
      };
    }),
    fetchGithubCommitFiles: vi.fn(async () => {
      fail();
      return [
        { path: "README.md", sha: "c".repeat(40), status: "added", additions: 10, deletions: 0 },
      ];
    }),
  };
});

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("Repository sync API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function connectedRepo(userId: string) {
    const suffix = uniqueSuffix();
    const record = await createRepository({
      githubId: `gh-sync-api-${suffix}`,
      owner: "o",
      name: `r-${suffix}`,
      fullName: `o/r-${suffix}`,
    });
    await linkUserRepository(userId, record.id, "owner");
    return record;
  }

  it("rejects anonymous sync requests", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/repositories/00000000-0000-0000-0000-000000000000/sync",
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects sync for repositories the user cannot access", async () => {
    const owner = await loginTestUser();
    const stranger = await loginTestUser();
    const repo = await connectedRepo(owner.user.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/repositories/${repo.id}/sync`,
      headers: { cookie: stranger.cookie },
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects malformed repository ids without leaking (privacy 404)", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "POST",
      url: "/api/repositories/not-a-uuid/sync",
      headers: { cookie: login.cookie },
    });
    // The authorization pre-handler maps malformed IDs to 404 before any
    // database access; SyncError 400 handling is covered at service level.
    expect(response.statusCode).toBe(404);
  });

  it("syncs and returns real counts", async () => {
    const login = await loginTestUser();
    const repo = await connectedRepo(login.user.id);
    mockState.authError = null;

    const response = await app.inject({
      method: "POST",
      url: `/api/repositories/${repo.id}/sync`,
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body).toMatchObject({
      status: "succeeded",
      branchCount: 1,
      commitCount: 1,
      fileCount: 1,
      contributorCount: 1,
    });
    expect(body.runId).toBeDefined();

    // Detail endpoint exposes persisted sync state + counts.
    const detail = await app.inject({
      method: "GET",
      url: `/api/repositories/${repo.id}`,
      headers: { cookie: login.cookie },
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = JSON.parse(detail.payload);
    expect(detailBody.syncStatus).toBe("succeeded");
    expect(detailBody.lastSuccessfulSyncAt).not.toBeNull();
    expect(detailBody.sync).toMatchObject({
      branches: 1,
      commits: 1,
      files: 1,
      contributors: 1,
    });
    expect(detailBody.sync.lastRun.status).toBe("succeeded");
  });

  it("maps rejected GitHub credentials without leaking secrets", async () => {
    const login = await loginTestUser();
    const repo = await connectedRepo(login.user.id);
    mockState.authError = new GithubApiError(401, "bad credential");

    const response = await app.inject({
      method: "POST",
      url: `/api/repositories/${repo.id}/sync`,
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.payload).error.code).toBe("GITHUB_AUTH_FAILED");
    expect(response.payload).not.toContain("accessToken");
    mockState.authError = null;
  });

  it("rejects a second concurrent sync with 409", async () => {
    const login = await loginTestUser();
    const repo = await connectedRepo(login.user.id);
    const { getDb } = await import("../../db/index.js");
    const { syncRuns } = await import("../../db/schema.js");
    const { eq, and } = await import("drizzle-orm");

    await getDb()
      .insert(syncRuns)
      .values({ repositoryId: repo.id, status: "running" });

    const response = await app.inject({
      method: "POST",
      url: `/api/repositories/${repo.id}/sync`,
      headers: { cookie: login.cookie },
    });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.payload).error.code).toBe("SYNC_IN_PROGRESS");

    await getDb()
      .update(syncRuns)
      .set({ status: "failed", finishedAt: new Date() })
      .where(
        and(eq(syncRuns.repositoryId, repo.id), eq(syncRuns.status, "running")),
      );
  });
});
