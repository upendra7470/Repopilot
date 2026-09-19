import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";
import {
  createRepository,
  linkUserRepository,
} from "../../services/repository.service.js";
import { getDb } from "../../db/index.js";
import { ciRuns, ciWorkflows } from "../../db/schema.js";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

describe("Incident API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seededBurst(userId: string) {
    const suffix = uniqueSuffix();
    const record = await createRepository({
      githubId: `gh-inc-api-${suffix}`,
      owner: "o",
      name: `r-${suffix}`,
      fullName: `o/r-${suffix}`,
    });
    await linkUserRepository(userId, record.id, "owner");
    const db = getDb();
    const [workflow] = await db
      .insert(ciWorkflows)
      .values({ repositoryId: record.id, githubId: "100", name: "CI", state: "active" })
      .returning({ id: ciWorkflows.id });
    for (const [i] of [1, 2, 3].entries()) {
      await db.insert(ciRuns).values({
        repositoryId: record.id,
        workflowId: workflow.id,
        githubId: String(i + 1),
        runNumber: i + 1,
        name: "CI",
        event: "push",
        status: "completed",
        conclusion: "failure",
        headBranch: "main",
        headSha: "a".repeat(40),
        githubCreatedAt: hoursAgo(3 - i),
        githubUpdatedAt: hoursAgo(3 - i),
      });
    }
    return record;
  }

  it("rejects anonymous incident access", async () => {
    const base = "/api/repositories/00000000-0000-0000-0000-000000000000";
    const fp = "a".repeat(64);
    for (const url of [
      `${base}/incidents`,
      `${base}/incidents/${fp}`,
      `${base}/incidents/${fp}/analysis`,
    ]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
    expect(
      (await app.inject({ method: "POST", url: `${base}/incidents/${fp}/analyze` })).statusCode,
    ).toBe(401);
  });

  it("rejects strangers and isolates repositories", async () => {
    const owner = await loginTestUser();
    const stranger = await loginTestUser();
    const record = await seededBurst(owner.user.id);
    const other = await seededBurst(owner.user.id);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/incidents`,
          headers: { cookie: stranger.cookie },
        })
      ).statusCode,
    ).toBe(404);

    // Same burst shape in two repos: fingerprints must differ per repo.
    const viaRecord = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/incidents`,
          headers: { cookie: owner.cookie },
        })
      ).payload,
    );
    const viaOther = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${other.id}/incidents`,
          headers: { cookie: owner.cookie },
        })
      ).payload,
    );
    expect(viaRecord.data).toHaveLength(1);
    expect(viaOther.data).toHaveLength(1);
    expect(viaRecord.data[0].fingerprint).not.toBe(viaOther.data[0].fingerprint);

    // Cross-repository fingerprint access fails.
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${other.id}/incidents/${viaRecord.data[0].fingerprint}`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("lists with filters and serves detail", async () => {
    const login = await loginTestUser();
    const record = await seededBurst(login.user.id);
    const headers = { cookie: login.cookie };

    const list = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/incidents?status=active`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.payload);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ status: "active", burstLength: 3 });
    const fp = body.data[0].fingerprint as string;

    const recovered = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/incidents?status=recovered`,
      headers,
    });
    expect(JSON.parse(recovered.payload).data).toHaveLength(0);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/incidents?status=bogus`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/incidents/not-hex`,
          headers,
        })
      ).statusCode,
    ).toBe(400);

    const detail = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/incidents/${fp}`,
      headers,
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = JSON.parse(detail.payload);
    expect(detailBody.evidence.length).toBeGreaterThan(3);
    expect(detailBody.unknowns.length).toBeGreaterThan(0);
    expect(JSON.stringify(detailBody)).not.toMatch(/caused by|root cause is/i);
  });

  it("reports AI unavailable without a provider and never fakes analysis", async () => {
    const login = await loginTestUser();
    const record = await seededBurst(login.user.id);
    const headers = { cookie: login.cookie };
    const fp = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/incidents`,
          headers,
        })
      ).payload,
    ).data[0].fingerprint as string;

    const latest = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/incidents/${fp}/analysis`,
      headers,
    });
    expect(JSON.parse(latest.payload).status).toBe("unavailable");

    const analyze = await app.inject({
      method: "POST",
      url: `/api/repositories/${record.id}/incidents/${fp}/analyze`,
      headers,
    });
    const analyzeBody = JSON.parse(analyze.payload);
    expect(analyzeBody.status).toBe("unavailable");
    expect(analyzeBody.analysis).toBeNull();
    expect(analyzeBody.error.code).toBe("AI_UNAVAILABLE");
  });

  it("never exposes credentials through incident payloads", async () => {
    const login = await loginTestUser();
    const record = await seededBurst(login.user.id);
    const response = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/incidents`,
      headers: { cookie: login.cookie },
    });
    expect(response.payload).not.toContain("accessToken");
    expect(response.payload).not.toContain("test-only-token");
  });
});
