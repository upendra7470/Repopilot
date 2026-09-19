import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";
import {
  createRepository,
  linkUserRepository,
} from "../../services/repository.service.js";
import { getDb } from "../../db/index.js";
import { commits } from "../../db/schema.js";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

describe("Engineering Brief API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seededRepo(userId: string, withActivity = true) {
    const suffix = uniqueSuffix();
    const record = await createRepository({
      githubId: `gh-brief-api-${suffix}`,
      owner: "o",
      name: `r-${suffix}`,
      fullName: `o/r-${suffix}`,
    });
    await linkUserRepository(userId, record.id, "owner");
    if (withActivity) {
      await getDb().insert(commits).values({
        repositoryId: record.id,
        sha: "d".repeat(40),
        message: "recent work",
        authorLogin: "alice",
        committedAt: hoursAgo(2),
      });
    }
    return record;
  }

  it("rejects anonymous brief access", async () => {
    const base = "/api/repositories/00000000-0000-0000-0000-000000000000";
    for (const url of [`${base}/brief`, `${base}/brief/analysis`]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
    expect(
      (await app.inject({ method: "POST", url: `${base}/brief/analyze` })).statusCode,
    ).toBe(401);
  });

  it("rejects strangers and isolates repositories", async () => {
    const owner = await loginTestUser();
    const stranger = await loginTestUser();
    const record = await seededRepo(owner.user.id);
    const other = await seededRepo(owner.user.id, false);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/brief`,
          headers: { cookie: stranger.cookie },
        })
      ).statusCode,
    ).toBe(404);

    // Same shape, different data: B's empty brief must not leak A's commit.
    const viaA = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/brief`,
          headers: { cookie: owner.cookie },
        })
      ).payload,
    );
    const viaB = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${other.id}/brief`,
          headers: { cookie: owner.cookie },
        })
      ).payload,
    );
    expect(viaA.counts.commits).toBe(1);
    expect(viaB.counts.commits).toBe(0);
    expect(JSON.stringify(viaB)).not.toContain("d".repeat(40));
  });

  it("validates the window parameter", async () => {
    const login = await loginTestUser();
    const record = await seededRepo(login.user.id);
    const headers = { cookie: login.cookie };

    for (const url of [
      `/api/repositories/${record.id}/brief?window=90`,
      `/api/repositories/${record.id}/brief/analysis?window=all`,
      `/api/repositories/${record.id}/brief?window=`,
    ]) {
      const method = url.includes("/analyze") ? "POST" : "GET";
      expect((await app.inject({ method, url, headers })).statusCode).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/repositories/${record.id}/brief/analyze?window=banana`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("serves a deterministic brief with a stable contract", async () => {
    const login = await loginTestUser();
    const record = await seededRepo(login.user.id);
    const headers = { cookie: login.cookie };

    const first = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/brief?window=7`,
      headers,
    });
    expect(first.statusCode).toBe(200);
    const body = JSON.parse(first.payload);
    expect(body.repository).toMatchObject({ id: record.id });
    expect(body.window).toMatchObject({ label: "7", days: 7 });
    expect(body.counts.commits).toBe(1);
    expect(body.whatChanged).toHaveLength(1);
    expect(body.unknowns.length).toBeGreaterThan(0);
    // Windows differ in content, not contract.
    const recent = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/brief?window=recent`,
          headers,
        })
      ).payload,
    );
    expect(recent.window).toMatchObject({ label: "recent", days: 3 });

    // Unknown repository id is a privacy-preserving 404.
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/00000000-0000-0000-0000-000000000000/brief`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("reports AI unavailable without a provider and never fakes analysis", async () => {
    const login = await loginTestUser();
    const record = await seededRepo(login.user.id);
    const headers = { cookie: login.cookie };

    const latest = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/brief/analysis`,
      headers,
    });
    expect(latest.statusCode).toBe(200);
    expect(JSON.parse(latest.payload).status).toBe("unavailable");

    const analyze = await app.inject({
      method: "POST",
      url: `/api/repositories/${record.id}/brief/analyze`,
      headers,
    });
    expect(analyze.statusCode).toBe(200);
    const analyzeBody = JSON.parse(analyze.payload);
    expect(analyzeBody.status).toBe("unavailable");
    expect(analyzeBody.analysis).toBeNull();
    expect(analyzeBody.error.code).toBe("AI_UNAVAILABLE");
  });

  it("never exposes credentials through brief payloads", async () => {
    const login = await loginTestUser();
    const record = await seededRepo(login.user.id);
    const response = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/brief`,
      headers: { cookie: login.cookie },
    });
    expect(response.payload).not.toContain("accessToken");
    expect(response.payload).not.toContain("test-only-token");
  });
});
