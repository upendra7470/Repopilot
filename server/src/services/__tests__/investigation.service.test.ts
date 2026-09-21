import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { resetEnv } from "../../config/env.js";
import { resetLogger } from "../../utils/logger.js";
import {
  buildInvestigationContext,
  normalizeInvestigationType,
} from "../investigation.service.js";
import { detectIncidents } from "../incident-intelligence.service.js";
import { getDb } from "../../db/index.js";
import {
  ciRuns,
  ciWorkflows,
  commitFiles,
  commits,
  contributors,
  files,
  issueCommitLinks,
  issues,
} from "../../db/schema.js";
import { handleGithubIdentity } from "../github-auth.service.js";
import { createRepository, linkUserRepository } from "../repository.service.js";

/**
 * Regression coverage for the investigation service (Phase 24).
 * These paths previously shipped with SQL construction defects
 * (missing join, UUID-vs-SHA comparisons, malformed LIKE, un-awaited
 * prefix resolution) that made whole entity classes throw.
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

const SHA_A = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHA_B = "b1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHA_C = "c1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

async function seededRepo() {
  const suffix = uniqueSuffix();
  const login = await handleGithubIdentity(
    {
      githubId: `gh-inv-${suffix}`,
      login: `invuser-${suffix}`,
      name: "Inv User",
      email: `inv-${suffix}@example.com`,
      avatarUrl: "https://example.com/avatar.png",
    },
    { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
  );
  const record = await createRepository({
    githubId: `gh-inv-repo-${suffix}`,
    owner: "o",
    name: `inv-${suffix}`,
    fullName: `o/inv-${suffix}`,
  });
  await linkUserRepository(login.user.id, record.id, "owner");

  const db = getDb();
  const [alice] = await db
    .insert(contributors)
    .values({ repositoryId: record.id, githubId: `gh-alice-${suffix}`, login: "alice" })
    .returning({ id: contributors.id });

  await db.insert(files).values({
    repositoryId: record.id,
    ref: "main",
    path: "src/auth/session.ts",
    type: "blob",
    size: 800,
  });

  const commitDefs = [
    { sha: SHA_A, message: "Add session handling", login: "alice" },
    { sha: SHA_B, message: "Harden session flags", login: "alice" },
    { sha: SHA_C, message: "Fix session refresh", login: "alice" },
  ];
  for (const c of commitDefs) {
    const [row] = await db
      .insert(commits)
      .values({
        repositoryId: record.id,
        sha: c.sha,
        message: c.message,
        authorLogin: c.login,
        contributorId: alice.id,
        committedAt: new Date(),
      })
      .returning({ id: commits.id });
    await db.insert(commitFiles).values({
      commitId: row.id,
      repositoryId: record.id,
      path: "src/auth/session.ts",
      status: "modified",
      additions: 10,
      deletions: 2,
    });
  }

  const [issue] = await db
    .insert(issues)
    .values({
      repositoryId: record.id,
      githubId: 1000 + Math.floor(Math.random() * 100000),
      number: 7,
      title: "Session flakes",
      state: "open",
      authorLogin: "alice",
    })
    .returning({ id: issues.id });
  const linkCommit = (
    await db
      .select({ id: commits.id })
      .from(commits)
      .where(and(eq(commits.repositoryId, record.id), eq(commits.sha, SHA_A)))
      .limit(1)
  )[0];
  await db.insert(issueCommitLinks).values({
    issueId: issue.id,
    commitId: linkCommit.id,
    repositoryId: record.id,
    evidence: "fixes #7",
  });

  const [wf] = await db
    .insert(ciWorkflows)
    .values({ repositoryId: record.id, githubId: "wf-inv", name: "CI", state: "active" })
    .returning({ id: ciWorkflows.id });
  const runShas = [SHA_A, SHA_B, SHA_C, SHA_C];
  for (let i = 0; i < runShas.length; i += 1) {
    await db.insert(ciRuns).values({
      repositoryId: record.id,
      workflowId: wf.id,
      githubId: `inv-run-${suffix}-${i}`,
      runNumber: 20 + i,
      name: "CI",
      event: "push",
      status: "completed",
      conclusion: i < 3 ? "failure" : "success",
      headBranch: "main",
      headSha: runShas[i],
      githubCreatedAt: new Date(Date.now() - (runShas.length - i) * 3_600_000),
      githubUpdatedAt: new Date(),
    });
  }

  return record.id;
}

describe("investigation entity-type normalization", () => {
  beforeEach(() => setupEnv());

  it("maps graph type names to canonical investigation types", () => {
    expect(normalizeInvestigationType("pull_request")).toBe("pr");
    expect(normalizeInvestigationType("ci_run")).toBe("run");
    expect(normalizeInvestigationType("ci_workflow")).toBe("workflow");
    expect(normalizeInvestigationType("pr")).toBe("pr");
    expect(normalizeInvestigationType("incident")).toBe("incident");
  });

  it("rejects unsupported types", () => {
    expect(normalizeInvestigationType("nonsense")).toBeNull();
    expect(normalizeInvestigationType("")).toBeNull();
  });
});

describe("buildInvestigationContext", () => {
  beforeEach(() => setupEnv());

  it("resolves a commit target with its files (UUID join, not SHA comparison)", async () => {
    const repoId = await seededRepo();
    const ctx = await buildInvestigationContext(repoId, { type: "commit", identifier: SHA_A });
    expect(ctx.target).toMatchObject({ type: "commit", identifier: SHA_A });
    expect(ctx.directRelationships.commits).toHaveLength(1);
    expect(ctx.directRelationships.files.map((f) => f.path)).toContain("src/auth/session.ts");
  });

  it("resolves a file target with full commit SHAs (awaited prefix resolution)", async () => {
    const repoId = await seededRepo();
    const ctx = await buildInvestigationContext(repoId, {
      type: "file",
      identifier: "src/auth/session.ts",
    });
    expect(ctx.directRelationships.files).toHaveLength(1);
    // All three linked commits must resolve to full 40-char SHAs — a
    // regression for the un-awaited findFullSha map that yielded Promises.
    const shas = ctx.directRelationships.commits.map((c) => c.sha);
    expect(shas).toHaveLength(3);
    for (const sha of shas) {
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(shas).toContain(SHA_A);
  });

  it("resolves a run target with its commit, files, and incident", async () => {
    const repoId = await seededRepo();
    const db = getDb();
    const run = (
      await db
        .select({ githubId: ciRuns.githubId })
        .from(ciRuns)
        .where(eq(ciRuns.repositoryId, repoId))
        .limit(1)
    )[0];
    const ctx = await buildInvestigationContext(repoId, { type: "run", identifier: run.githubId });
    expect(ctx.directRelationships.runs).toHaveLength(1);
    expect(ctx.directRelationships.commits.length).toBeGreaterThan(0);
    expect(ctx.directRelationships.files.length).toBeGreaterThan(0);
  });

  it("resolves an incident target end to end", async () => {
    const repoId = await seededRepo();
    const incidents = await detectIncidents(repoId);
    expect(incidents.length).toBeGreaterThan(0);
    const ctx = await buildInvestigationContext(repoId, {
      type: "incident",
      identifier: incidents[0].fingerprint,
    });
    expect(ctx.directRelationships.incidents).toHaveLength(1);
    expect(ctx.directRelationships.runs.length).toBeGreaterThan(0);
    expect(ctx.temporalRelationships.incidentTimeline.length).toBeGreaterThan(0);
  });

  it("accepts graph-style type names", async () => {
    const repoId = await seededRepo();
    const db = getDb();
    const run = (
      await db
        .select({ githubId: ciRuns.githubId })
        .from(ciRuns)
        .where(eq(ciRuns.repositoryId, repoId))
        .limit(1)
    )[0];
    const ctx = await buildInvestigationContext(repoId, {
      type: "ci_run",
      identifier: run.githubId,
    } as unknown as { type: "run"; identifier: string });
    expect(ctx.target.type).toBe("run");
    expect(ctx.directRelationships.runs).toHaveLength(1);
  });

  it("rejects unsupported target types without touching the database", async () => {
    const repoId = await seededRepo();
    await expect(
      buildInvestigationContext(repoId, { type: "nonsense", identifier: "x" } as never),
    ).rejects.toThrow(/Unsupported investigation entity type/);
  });

  it("returns an explicit-unknowns context for missing entities", async () => {
    const repoId = await seededRepo();
    const ctx = await buildInvestigationContext(repoId, { type: "pr", identifier: "424242" });
    expect(ctx.directRelationships.prs).toHaveLength(0);
    expect(ctx.unknowns.length).toBeGreaterThan(0);
  });
});
