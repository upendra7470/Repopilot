import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";
import {
  createRepository,
  linkUserRepository,
} from "../../services/repository.service.js";
import { getDb } from "../../db/index.js";
import { commits, commitFiles } from "../../db/schema.js";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("Repository risks API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seededRepo(userId: string) {
    const suffix = uniqueSuffix();
    const record = await createRepository({
      githubId: `gh-risk-api-${suffix}`,
      owner: "o",
      name: `r-${suffix}`,
      fullName: `o/r-${suffix}`,
    });
    await linkUserRepository(userId, record.id, "owner");
    const db = getDb();
    const [commit] = await db
      .insert(commits)
      .values({
        repositoryId: record.id,
        sha: "a".repeat(40),
        message: "fix something",
        authorLogin: "alice",
        committedAt: new Date(),
      })
      .returning({ id: commits.id });
    await db.insert(commitFiles).values({
      commitId: commit.id,
      repositoryId: record.id,
      path: "src/hot.ts",
      status: "modified",
      additions: 5,
      deletions: 1,
    });
    return record;
  }

  it("rejects anonymous risk requests", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/repositories/00000000-0000-0000-0000-000000000000/risks",
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects strangers with a privacy-preserving 404", async () => {
    const owner = await loginTestUser();
    const stranger = await loginTestUser();
    const record = await seededRepo(owner.user.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/risks`,
      headers: { cookie: stranger.cookie },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns a deterministic report for the owner", async () => {
    const login = await loginTestUser();
    const record = await seededRepo(login.user.id);

    const first = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/risks`,
      headers: { cookie: login.cookie },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = JSON.parse(first.payload);
    expect(firstBody.repository.fullName).toBe(record.fullName);
    expect(firstBody.analysisWindow).toMatchObject({ type: "days", value: 30 });
    expect(firstBody.summary.total).toBe(firstBody.findings.length);
    expect(
      firstBody.findings.some((f: { type: string }) => f.type === "corrective_activity"),
    ).toBe(true);
    for (const finding of firstBody.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.recommendation).toBeTruthy();
      expect(finding.id).toMatch(/^v1:/);
    }

    const second = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/risks`,
      headers: { cookie: login.cookie },
    });
    const secondBody = JSON.parse(second.payload);
    expect(secondBody.findings).toEqual(firstBody.findings);
  });

  it("returns a valid empty report when there is nothing to analyze", async () => {
    const login = await loginTestUser();
    const suffix = uniqueSuffix();
    const record = await createRepository({
      githubId: `gh-risk-empty-${suffix}`,
      owner: "o",
      name: `empty-${suffix}`,
      fullName: `o/empty-${suffix}`,
    });
    await linkUserRepository(login.user.id, record.id, "owner");

    const response = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/risks`,
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.summary).toEqual({ total: 0, critical: 0, high: 0, medium: 0, low: 0 });
    expect(body.findings).toEqual([]);
  });

  it("never leaks tokens or secrets in risk responses", async () => {
    const login = await loginTestUser();
    const record = await seededRepo(login.user.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/risks`,
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).not.toContain("accessToken");
    expect(response.payload).not.toContain("access_token");
    expect(response.payload).not.toContain("tokenHash");
  });
});
