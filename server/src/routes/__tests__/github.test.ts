import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";
import { GithubApiError } from "../../services/github-provider.js";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    list: [] as Array<Record<string, unknown>>,
    get: null as Record<string, unknown> | null,
    getError: null as GithubApiError | null,
  },
}));

vi.mock("../../services/github-provider.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../services/github-provider.js")>();
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

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("GitHub discovery and connection API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated discovery and connect requests", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/api/github/repositories" }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/repositories/connect",
          payload: { owner: "o", name: "n" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("discovers repositories with explicit pagination", async () => {
    const login = await loginTestUser();
    mockState.list = [ghRepo(11, "octocat", "one"), ghRepo(12, "octocat", "two")];

    const response = await app.inject({
      method: "GET",
      url: "/api/github/repositories?query=one",
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.pagination).toMatchObject({ page: 1, perPage: 20, total: 1 });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      fullName: "octocat/one",
      connected: false,
    });
    expect(response.payload).not.toContain("accessToken");
  });

  it("rejects invalid discovery parameters", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "GET",
      url: "/api/github/repositories?per_page=999",
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(400);
  });

  it("maps a rejected GitHub credential to 502 without secrets", async () => {
    const login = await loginTestUser();
    const { clearGithubCredential } = await import(
      "../../services/credential-store.js"
    );
    await clearGithubCredential(login.user.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/github/repositories",
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.payload).error.code).toBe("GITHUB_AUTH_FAILED");
    expect(response.payload).not.toContain("accessToken");
  });

  it("connects an accessible repository (201) and rejects duplicates (409)", async () => {
    const login = await loginTestUser();
    const suffix = uniqueSuffix();
    mockState.get = ghRepo(50000 + Date.now() % 100000, "octocat", `ship-${suffix}`);

    const first = await app.inject({
      method: "POST",
      url: "/api/repositories/connect",
      headers: { cookie: login.cookie },
      payload: { owner: "octocat", name: `ship-${suffix}` },
    });
    expect(first.statusCode).toBe(201);
    const created = JSON.parse(first.payload);
    expect(created.fullName).toBe(`octocat/ship-${suffix}`);
    expect(created.connectionStatus).toBe("connected");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/repositories/connect",
      headers: { cookie: login.cookie },
      payload: { owner: "octocat", name: `ship-${suffix}` },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(JSON.parse(duplicate.payload).error.code).toBe("ALREADY_CONNECTED");
  });

  it("returns 404 for repositories GitHub does not reveal", async () => {
    const login = await loginTestUser();
    mockState.getError = new GithubApiError(404, "missing");
    mockState.get = null;

    const response = await app.inject({
      method: "POST",
      url: "/api/repositories/connect",
      headers: { cookie: login.cookie },
      payload: { owner: "octocat", name: "does-not-exist" },
    });

    expect(response.statusCode).toBe(404);
    mockState.getError = null;
  });

  it("rejects malformed connect payloads", async () => {
    const login = await loginTestUser();

    const missing = await app.inject({
      method: "POST",
      url: "/api/repositories/connect",
      headers: { cookie: login.cookie },
      payload: { owner: "octocat" },
    });
    expect(missing.statusCode).toBe(400);

    const malformed = await app.inject({
      method: "POST",
      url: "/api/repositories/connect",
      headers: { cookie: login.cookie },
      payload: { owner: "not an owner!", name: "x" },
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("a connected repository is readable by its owner only", async () => {
    const owner = await loginTestUser();
    const stranger = await loginTestUser();
    const suffix = uniqueSuffix();
    mockState.get = ghRepo(60000 + Date.now() % 100000, "octocat", `priv-${suffix}`);

    const created = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/repositories/connect",
          headers: { cookie: owner.cookie },
          payload: { owner: "octocat", name: `priv-${suffix}` },
        })
      ).payload,
    );

    const strangerRes = await app.inject({
      method: "GET",
      url: `/api/repositories/${created.id}`,
      headers: { cookie: stranger.cookie },
    });
    expect(strangerRes.statusCode).toBe(404);

    const ownerRes = await app.inject({
      method: "GET",
      url: `/api/repositories/${created.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(ownerRes.statusCode).toBe(200);
  });
});
