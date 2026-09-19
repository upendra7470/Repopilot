import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";
import {
  createRepository,
  linkUserRepository,
} from "../../services/repository.service.js";
import { getDb } from "../../db/index.js";
import { ciJobs, ciRuns, ciWorkflows } from "../../db/schema.js";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("CI API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seededCi(userId: string) {
    const suffix = uniqueSuffix();
    const record = await createRepository({
      githubId: `gh-ci-api-${suffix}`,
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
    const [run] = await db
      .insert(ciRuns)
      .values({
        repositoryId: record.id,
        workflowId: workflow.id,
        githubId: "812",
        runNumber: 812,
        name: "CI",
        event: "push",
        status: "completed",
        conclusion: "failure",
        headBranch: "main",
        headSha: "a".repeat(40),
        prNumbers: [],
      })
      .returning({ id: ciRuns.id });
    await db.insert(ciJobs).values({
      runId: run.id,
      repositoryId: record.id,
      githubId: "1",
      name: "test",
      status: "completed",
      conclusion: "failure",
    });
    return record;
  }

  it("rejects anonymous CI access", async () => {
    const base = "/api/repositories/00000000-0000-0000-0000-000000000000";
    const urls = [
      `${base}/ci`,
      `${base}/ci/workflows`,
      `${base}/ci/workflows/100`,
      `${base}/ci/runs`,
      `${base}/ci/runs/812`,
      `${base}/ci/runs/812/analysis`,
    ];
    for (const url of urls) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
    expect(
      (await app.inject({ method: "POST", url: `${base}/ci/runs/812/analyze` })).statusCode,
    ).toBe(401);
  });

  it("rejects strangers and cross-repository access with 404", async () => {
    const owner = await loginTestUser();
    const stranger = await loginTestUser();
    const record = await seededCi(owner.user.id);
    const other = await seededCi(owner.user.id);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/ci`,
          headers: { cookie: stranger.cookie },
        })
      ).statusCode,
    ).toBe(404);

    // Same GitHub run id in two repos: each endpoint serves only its own.
    const viaRecord = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/ci/runs/812`,
      headers: { cookie: owner.cookie },
    });
    const viaOther = await app.inject({
      method: "GET",
      url: `/api/repositories/${other.id}/ci/runs/812`,
      headers: { cookie: owner.cookie },
    });
    expect(viaRecord.statusCode).toBe(200);
    expect(viaOther.statusCode).toBe(200);
    expect(JSON.parse(viaRecord.payload).run.id).not.toBe(
      JSON.parse(viaOther.payload).run.id,
    );

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/ci/runs/999999`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/ci/workflows/999999`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("serves summary, workflows, and filtered runs", async () => {
    const login = await loginTestUser();
    const record = await seededCi(login.user.id);
    const headers = { cookie: login.cookie };

    const summary = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/ci`,
      headers,
    });
    expect(summary.statusCode).toBe(200);
    const summaryBody = JSON.parse(summary.payload);
    expect(summaryBody.counts).toMatchObject({ workflows: 1, runs: 1, failed: 1 });
    expect(summaryBody.workflows).toHaveLength(1);
    expect(summaryBody.recentRuns).toHaveLength(1);
    expect(summaryBody.signals.some((s: { type: string }) => s.type === "recent_failure")).toBe(true);

    const workflows = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/ci/workflows`,
      headers,
    });
    expect(JSON.parse(workflows.payload)).toHaveLength(1);

    const runs = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/ci/runs?conclusion=failure`,
      headers,
    });
    expect(JSON.parse(runs.payload).data).toHaveLength(1);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/ci/runs?conclusion=success`,
          headers,
        })
      ),
    ).toBeDefined();
    expect(
      JSON.parse(
        (
          await app.inject({
            method: "GET",
            url: `/api/repositories/${record.id}/ci/runs?conclusion=success`,
            headers,
          })
        ).payload,
      ).data,
    ).toHaveLength(0);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/ci/runs/not-a-run`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("serves run detail with jobs and empty-code honesty", async () => {
    const login = await loginTestUser();
    const record = await seededCi(login.user.id);
    const headers = { cookie: login.cookie };

    const detail = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/ci/runs/812`,
      headers,
    });
    expect(detail.statusCode).toBe(200);
    const body = JSON.parse(detail.payload);
    expect(body.run.githubId).toBe("812");
    expect(body.jobs).toHaveLength(1);
    expect(body.commit).toBeNull();
    expect(body.files).toEqual([]);
    expect(body.signals.some((s: { type: string }) => s.type === "run_failed")).toBe(true);
  });

  it("reports AI unavailable without a provider and never fakes analysis", async () => {
    const login = await loginTestUser();
    const record = await seededCi(login.user.id);
    const headers = { cookie: login.cookie };

    const latest = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/ci/runs/812/analysis`,
      headers,
    });
    expect(JSON.parse(latest.payload).status).toBe("unavailable");

    const analyze = await app.inject({
      method: "POST",
      url: `/api/repositories/${record.id}/ci/runs/812/analyze`,
      headers,
    });
    const analyzeBody = JSON.parse(analyze.payload);
    expect(analyzeBody.status).toBe("unavailable");
    expect(analyzeBody.analysis).toBeNull();
    expect(analyzeBody.error.code).toBe("AI_UNAVAILABLE");
  });

  it("never exposes credentials through CI payloads", async () => {
    const login = await loginTestUser();
    const record = await seededCi(login.user.id);
    const response = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/ci`,
      headers: { cookie: login.cookie },
    });
    expect(response.payload).not.toContain("accessToken");
    expect(response.payload).not.toContain("test-only-token");
  });
});
