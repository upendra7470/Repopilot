import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";
import {
  createRepository,
  linkUserRepository,
} from "../../services/repository.service.js";
import { getDb } from "../../db/index.js";
import { prFiles, pullRequests } from "../../db/schema.js";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("Pull request API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seededPr(userId: string, number = 42) {
    const suffix = uniqueSuffix();
    const record = await createRepository({
      githubId: `gh-pulls-api-${suffix}`,
      owner: "o",
      name: `r-${suffix}`,
      fullName: `o/r-${suffix}`,
    });
    await linkUserRepository(userId, record.id, "owner");
    const db = getDb();
    const [pr] = await db
      .insert(pullRequests)
      .values({
        repositoryId: record.id,
        githubId: `gh-pr-${suffix}`,
        number,
        title: "Refactor auth",
        body: "Cleanup.",
        state: "open",
        authorLogin: "bob",
        sourceBranch: "refactor",
        targetBranch: "main",
        additions: 100,
        deletions: 20,
        changedFilesCount: 2,
      })
      .returning({ id: pullRequests.id });
    await db.insert(prFiles).values({
      pullRequestId: pr.id,
      repositoryId: record.id,
      path: "src/a.ts",
      status: "modified",
      additions: 100,
      deletions: 20,
    });
    return record;
  }

  it("rejects anonymous PR access", async () => {
    const urls = [
      "/api/repositories/00000000-0000-0000-0000-000000000000/pulls",
      "/api/repositories/00000000-0000-0000-0000-000000000000/pulls/1",
      "/api/repositories/00000000-0000-0000-0000-000000000000/pulls/1/intelligence",
      "/api/repositories/00000000-0000-0000-0000-000000000000/pulls/1/analysis",
    ];
    for (const url of urls) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/repositories/00000000-0000-0000-0000-000000000000/pulls/1/analyze",
        })
      ).statusCode,
    ).toBe(401);
  });

  it("rejects strangers with privacy-preserving 404", async () => {
    const owner = await loginTestUser();
    const stranger = await loginTestUser();
    const record = await seededPr(owner.user.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/pulls`,
      headers: { cookie: stranger.cookie },
    });
    expect(response.statusCode).toBe(404);
  });

  it("lists PRs with state filters for the owner", async () => {
    const login = await loginTestUser();
    const record = await seededPr(login.user.id);
    const headers = { cookie: login.cookie };

    const all = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/pulls`,
      headers,
    });
    expect(all.statusCode).toBe(200);
    expect(JSON.parse(all.payload)).toHaveLength(1);

    const open = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/pulls?state=open`,
      headers,
    });
    expect(JSON.parse(open.payload)).toHaveLength(1);

    const merged = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/pulls?state=merged`,
      headers,
    });
    expect(JSON.parse(merged.payload)).toHaveLength(0);

    const badFilter = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/pulls?state=bogus`,
      headers,
    });
    expect(badFilter.statusCode).toBe(400);
  });

  it("serves PR detail with files and validates numbers", async () => {
    const login = await loginTestUser();
    const record = await seededPr(login.user.id);
    const headers = { cookie: login.cookie };

    const detail = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/pulls/42`,
      headers,
    });
    expect(detail.statusCode).toBe(200);
    const body = JSON.parse(detail.payload);
    expect(body.pr).toMatchObject({ number: 42, title: "Refactor auth" });
    expect(body.files).toHaveLength(1);
    expect(body.files[0].path).toBe("src/a.ts");

    const unknown = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/pulls/999`,
      headers,
    });
    expect(unknown.statusCode).toBe(404);

    const malformed = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/pulls/abc`,
      headers,
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("serves deterministic intelligence for a PR", async () => {
    const login = await loginTestUser();
    const record = await seededPr(login.user.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/pulls/42/intelligence`,
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.stats).toMatchObject({ commits: 0 });
    expect(Array.isArray(body.signals)).toBe(true);
    expect(body.areas).toEqual([{ area: "src", changes: 1 }]);
  });

  it("reports AI unavailable without configuration", async () => {
    const login = await loginTestUser();
    const record = await seededPr(login.user.id);
    const headers = { cookie: login.cookie };

    const latest = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/pulls/42/analysis`,
      headers,
    });
    expect(latest.statusCode).toBe(200);
    expect(JSON.parse(latest.payload).status).toBe("unavailable");

    const analyze = await app.inject({
      method: "POST",
      url: `/api/repositories/${record.id}/pulls/42/analyze`,
      headers,
    });
    expect(analyze.statusCode).toBe(200);
    const body = JSON.parse(analyze.payload);
    expect(body.status).toBe("unavailable");
    expect(body.error.code).toBe("AI_UNAVAILABLE");
  });

  it("rejects analyze for unknown PRs and malformed numbers", async () => {
    const login = await loginTestUser();
    const record = await seededPr(login.user.id);
    const headers = { cookie: login.cookie };

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/repositories/${record.id}/pulls/999/analyze`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/repositories/${record.id}/pulls/zero/analyze`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
  });
});
