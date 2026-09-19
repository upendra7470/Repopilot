import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";
import {
  createRepository,
  linkUserRepository,
} from "../../services/repository.service.js";
import { getDb } from "../../db/index.js";
import { issueComments, issues } from "../../db/schema.js";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("Issue API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seededIssue(userId: string, number = 184) {
    const suffix = uniqueSuffix();
    const record = await createRepository({
      githubId: `gh-issues-api-${suffix}`,
      owner: "o",
      name: `r-${suffix}`,
      fullName: `o/r-${suffix}`,
    });
    await linkUserRepository(userId, record.id, "owner");
    const db = getDb();
    const [issue] = await db
      .insert(issues)
      .values({
        repositoryId: record.id,
        githubId: `gh-issue-${suffix}`,
        number,
        title: "Session refresh loop",
        body: "Loops on expiry.",
        state: "open",
        authorLogin: "alice",
        commentsCount: 1,
        labels: ["bug"],
        assignees: [],
      })
      .returning({ id: issues.id });
    await db.insert(issueComments).values({
      issueId: issue.id,
      repositoryId: record.id,
      githubId: `c-${suffix}`,
      authorLogin: "bob",
      body: "Reproduced.",
    });
    return record;
  }

  it("rejects anonymous issue access", async () => {
    const urls = [
      "/api/repositories/00000000-0000-0000-0000-000000000000/issues",
      "/api/repositories/00000000-0000-0000-0000-000000000000/issues/1",
      "/api/repositories/00000000-0000-0000-0000-000000000000/issues/1/intelligence",
      "/api/repositories/00000000-0000-0000-0000-000000000000/issues/1/analysis",
    ];
    for (const url of urls) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/repositories/00000000-0000-0000-0000-000000000000/issues/1/analyze",
        })
      ).statusCode,
    ).toBe(401);
  });

  it("rejects strangers with privacy-preserving 404", async () => {
    const owner = await loginTestUser();
    const stranger = await loginTestUser();
    const record = await seededIssue(owner.user.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/issues`,
      headers: { cookie: stranger.cookie },
    });
    expect(response.statusCode).toBe(404);
  });

  it("blocks cross-repository issue access", async () => {
    const login = await loginTestUser();
    const recordA = await seededIssue(login.user.id, 11);
    const recordB = await seededIssue(login.user.id, 11);
    const headers = { cookie: login.cookie };

    // Same number exists in both repos; B's endpoint must not serve A's issue
    // and A's issue must resolve through A's endpoint.
    const viaA = await app.inject({
      method: "GET",
      url: `/api/repositories/${recordA.id}/issues/11`,
      headers,
    });
    expect(viaA.statusCode).toBe(200);

    const viaB = await app.inject({
      method: "GET",
      url: `/api/repositories/${recordB.id}/issues/11`,
      headers,
    });
    expect(viaB.statusCode).toBe(200);
    expect(JSON.parse(viaA.payload).issue.id).not.toBe(
      JSON.parse(viaB.payload).issue.id,
    );

    const missing = await app.inject({
      method: "GET",
      url: `/api/repositories/${recordA.id}/issues/999999`,
      headers,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("lists issues with filters, sorts, and pagination for the owner", async () => {
    const login = await loginTestUser();
    const record = await seededIssue(login.user.id);
    const headers = { cookie: login.cookie };

    const open = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/issues?state=open`,
      headers,
    });
    expect(open.statusCode).toBe(200);
    const openBody = JSON.parse(open.payload);
    expect(openBody.data).toHaveLength(1);
    expect(openBody.data[0]).toMatchObject({ number: 184, state: "open" });
    expect(openBody.pagination).toMatchObject({ page: 1, total: 1 });

    const closed = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/issues?state=closed`,
      headers,
    });
    expect(JSON.parse(closed.payload).data).toHaveLength(0);

    const labeled = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/issues?state=all&label=bug`,
      headers,
    });
    expect(JSON.parse(labeled.payload).data).toHaveLength(1);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/issues?state=bogus`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/issues?sort=smart`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/issues/abc`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("serves detail with comments and deterministic intelligence", async () => {
    const login = await loginTestUser();
    const record = await seededIssue(login.user.id);
    const headers = { cookie: login.cookie };

    const detail = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/issues/184`,
      headers,
    });
    expect(detail.statusCode).toBe(200);
    const body = JSON.parse(detail.payload);
    expect(body.issue.number).toBe(184);
    expect(body.issue.body).toContain("Loops on expiry");
    expect(body.comments).toHaveLength(1);
    expect(body.issue.signals).toBeDefined();
    expect(body.issue.dimensions).toBeDefined();

    const intel = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/issues/184/intelligence`,
      headers,
    });
    expect(intel.statusCode).toBe(200);
    const intelBody = JSON.parse(intel.payload);
    expect(Array.isArray(intelBody.signals)).toBe(true);
    expect(intelBody.dimensions.state).toBe("open");
    expect(intelBody.recentComments).toHaveLength(1);
  });

  it("reports AI unavailable without a provider and never fakes analysis", async () => {
    const login = await loginTestUser();
    const record = await seededIssue(login.user.id);
    const headers = { cookie: login.cookie };

    const latest = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/issues/184/analysis`,
      headers,
    });
    expect(latest.statusCode).toBe(200);
    expect(JSON.parse(latest.payload).status).toBe("unavailable");

    const analyze = await app.inject({
      method: "POST",
      url: `/api/repositories/${record.id}/issues/184/analyze`,
      headers,
    });
    expect(analyze.statusCode).toBe(200);
    const analyzeBody = JSON.parse(analyze.payload);
    expect(analyzeBody.status).toBe("unavailable");
    expect(analyzeBody.analysis).toBeNull();
    expect(analyzeBody.error.code).toBe("AI_UNAVAILABLE");
  });

  it("never exposes credentials through issue payloads", async () => {
    const login = await loginTestUser();
    const record = await seededIssue(login.user.id);
    const response = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/issues`,
      headers: { cookie: login.cookie },
    });
    expect(response.payload).not.toContain("accessToken");
    expect(response.payload).not.toContain("test-only-token");
  });
});
