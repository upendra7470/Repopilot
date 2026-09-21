import { describe, it, expect, beforeEach } from "vitest";
import { resetEnv } from "../../config/env.js";
import { resetLogger } from "../../utils/logger.js";
import { answerQuestion } from "../ask.service.js";
import { getDb } from "../../db/index.js";
import {
  ciRuns,
  ciWorkflows,
  commitFiles,
  commits,
  contributors,
  files,
} from "../../db/schema.js";
import { handleGithubIdentity } from "../github-auth.service.js";
import { createRepository, linkUserRepository } from "../repository.service.js";

/**
 * Retrieval-level grounding tests (Phase 24). Covers canonical evidence-ID
 * uniformity: the same commit must never appear twice under a short and a
 * full-length ID.
 */

function setupEnv(): void {
  resetEnv();
  resetLogger();
  process.env.DATABASE_URL = "postgresql://localhost:5432/repopilot_test";
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.AUTH_SECRET = "test-only-auth-secret-at-least-32-chars!!";
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("answerQuestion evidence canonicalization", () => {
  beforeEach(() => setupEnv());

  it("emits each incident commit once under its canonical short ID", async () => {
    const suffix = uniqueSuffix();
    const login = await handleGithubIdentity(
      {
        githubId: `gh-askc-${suffix}`,
        login: `askcuser-${suffix}`,
        name: "Ask C User",
        email: `askc-${suffix}@example.com`,
        avatarUrl: "https://example.com/avatar.png",
      },
      { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
    );
    const record = await createRepository({
      githubId: `gh-askc-repo-${suffix}`,
      owner: "o",
      name: `askc-${suffix}`,
      fullName: `o/askc-${suffix}`,
    });
    await linkUserRepository(login.user.id, record.id, "owner");

    const db = getDb();
    const [contrib] = await db
      .insert(contributors)
      .values({ repositoryId: record.id, githubId: `gh-c-${suffix}`, login: "dev" })
      .returning({ id: contributors.id });
    await db.insert(files).values({
      repositoryId: record.id,
      ref: "main",
      path: "src/app.ts",
      type: "blob",
      size: 100,
    });

    const shas = [
      "aa11bb22cc33dd44ee55ff660011223344556677",
      "bb11bb22cc33dd44ee55ff660011223344556677",
      "cc11bb22cc33dd44ee55ff660011223344556677",
    ];
    for (const sha of shas) {
      const [row] = await db
        .insert(commits)
        .values({
          repositoryId: record.id,
          sha,
          message: `Change ${sha.slice(0, 7)}`,
          authorLogin: "dev",
          contributorId: contrib.id,
          committedAt: new Date(),
        })
        .returning({ id: commits.id });
      await db.insert(commitFiles).values({
        commitId: row.id,
        repositoryId: record.id,
        path: "src/app.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
      });
    }

    const [wf] = await db
      .insert(ciWorkflows)
      .values({ repositoryId: record.id, githubId: "wf-askc", name: "CI", state: "active" })
      .returning({ id: ciWorkflows.id });
    for (let i = 0; i < shas.length; i += 1) {
      await db.insert(ciRuns).values({
        repositoryId: record.id,
        workflowId: wf.id,
        githubId: `askc-run-${suffix}-${i}`,
        runNumber: 30 + i,
        name: "CI",
        event: "push",
        status: "completed",
        conclusion: "failure",
        headBranch: "main",
        headSha: shas[i],
        githubCreatedAt: new Date(Date.now() - (shas.length - i) * 3_600_000),
        githubUpdatedAt: new Date(),
      });
    }

    const result = await answerQuestion(record.id, "What happened around the latest incident?", []);
    expect(result.entities.some((e) => e.kind === "incident")).toBe(true);

    const commitIds = result.evidence.filter((e) => e.kind === "commit").map((e) => e.id);
    expect(commitIds.length).toBeGreaterThan(0);
    // Canonical form: commit:<12 hex chars>, no full-length duplicates.
    for (const id of commitIds) {
      expect(id).toMatch(/^commit:[0-9a-f]{12}$/);
    }
    expect(new Set(commitIds).size).toBe(commitIds.length);
  });
});
