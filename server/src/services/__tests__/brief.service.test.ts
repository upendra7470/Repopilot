import { describe, it, expect, beforeEach } from "vitest";
import {
  getEngineeringBrief,
  parseBriefWindow,
} from "../brief.service.js";
import { analyzeRepositoryRisks } from "../risk.service.js";
import { detectIncidents } from "../incident-intelligence.service.js";
import { handleGithubIdentity } from "../github-auth.service.js";
import {
  createRepository,
  linkUserRepository,
} from "../repository.service.js";
import { getDb } from "../../db/index.js";
import {
  ciRuns,
  ciWorkflows,
  commits,
  commitFiles,
  issues,
  pullRequests,
} from "../../db/schema.js";

function setupEnv(): void {
  process.env.DATABASE_URL = "postgresql://localhost:5432/repopilot_test";
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.AUTH_SECRET = "test-only-auth-secret-at-least-32-chars!!";
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

async function setupRepo() {
  const suffix = uniqueSuffix();
  const login = await handleGithubIdentity(
    {
      githubId: `gh-br-${suffix}`,
      login: `br-${suffix}`,
      name: null,
      email: null,
      avatarUrl: null,
    },
    { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
  );
  const record = await createRepository({
    githubId: `gh-br-repo-${suffix}`,
    owner: "o",
    name: `r-${suffix}`,
    fullName: `o/r-${suffix}`,
  });
  await linkUserRepository(login.user.id, record.id, "owner");
  return { userId: login.user.id, record };
}

async function seedCommit(
  repositoryId: string,
  sha: string,
  message: string,
  committedAt: Date,
  login: string | null = "alice",
  paths: string[] = ["src/app.ts"],
) {
  const db = getDb();
  const [commit] = await db
    .insert(commits)
    .values({
      repositoryId,
      sha,
      message,
      authorLogin: login,
      committedAt,
    })
    .returning({ id: commits.id });
  for (const path of paths) {
    await db.insert(commitFiles).values({
      commitId: commit.id,
      repositoryId,
      path,
      status: "modified",
      additions: 10,
      deletions: 2,
    });
  }
  return commit;
}

describe("parseBriefWindow", () => {
  it("accepts recent, 7, and 30 with documented day counts", () => {
    expect(parseBriefWindow(undefined)).toMatchObject({ label: "recent", days: 3 });
    expect(parseBriefWindow("recent")).toMatchObject({ label: "recent", days: 3 });
    expect(parseBriefWindow("7")).toMatchObject({ label: "7", days: 7 });
    expect(parseBriefWindow("30")).toMatchObject({ label: "30", days: 30 });
  });

  it("rejects anything else", () => {
    expect(parseBriefWindow("90")).toBeNull();
    expect(parseBriefWindow("all")).toBeNull();
    expect(parseBriefWindow("")).toBeNull();
  });

  it("defaults missing input to the recent window", () => {
    expect(parseBriefWindow(undefined)).toMatchObject({ label: "recent", days: 3 });
    expect(parseBriefWindow(null)).toMatchObject({ label: "recent" });
  });
});

describe("Engineering brief composition", () => {
  beforeEach(() => {
    setupEnv();
  });

  it("returns null for unknown repositories", async () => {
    const window = parseBriefWindow("7")!;
    expect(
      await getEngineeringBrief("00000000-0000-0000-0000-000000000000", window),
    ).toBeNull();
  });

  it("produces a valid honest brief for an empty repository", async () => {
    const { record } = await setupRepo();
    const window = parseBriefWindow("7")!;
    const brief = await getEngineeringBrief(record.id, window);
    expect(brief).not.toBeNull();
    expect(brief!.counts).toMatchObject({
      commits: 0,
      contributors: 0,
      filesChanged: 0,
      prsOpened: 0,
      issuesOpened: 0,
      ciFailures: 0,
    });
    expect(brief!.whatChanged).toEqual([]);
    expect(brief!.failures).toEqual([]);
    expect(brief!.incidents).toEqual([]);
    expect(brief!.relationships).toEqual([]);
    expect(brief!.evidence).toEqual([]);
    expect(brief!.summary.length).toBeGreaterThan(0);
    // Honest unknowns, no fabricated activity.
    expect(brief!.unknowns.join(" ")).toMatch(/No commits were synchronized/);
    expect(brief!.unknowns.join(" ")).toMatch(/Production impact is unknown/);
    expect(brief!.unknowns.join(" ")).toMatch(/CI logs are unavailable/);
    expect(JSON.stringify(brief)).not.toMatch(/healthy|revenue|customer/i);
  });

  it("respects window boundaries for commits", async () => {
    const { record } = await setupRepo();
    await seedCommit(record.id, "a".repeat(40), "recent work", hoursAgo(5));
    await seedCommit(record.id, "b".repeat(40), "ten days ago", daysAgo(10));
    await seedCommit(record.id, "c".repeat(40), "forty days ago", daysAgo(40));

    const recent = await getEngineeringBrief(record.id, parseBriefWindow("recent")!);
    expect(recent!.counts.commits).toBe(1);
    expect(recent!.whatChanged.map((i) => i.entityId)).toEqual(["a".repeat(40)]);

    const week = await getEngineeringBrief(record.id, parseBriefWindow("7")!);
    expect(week!.counts.commits).toBe(1);

    const month = await getEngineeringBrief(record.id, parseBriefWindow("30")!);
    expect(month!.counts.commits).toBe(2);
    expect(month!.whatChanged.map((i) => i.entityId).sort()).toEqual(
      ["a".repeat(40), "b".repeat(40)].sort(),
    );
  });

  it("composes mixed evidence with traceable references", async () => {
    const { record } = await setupRepo();
    const db = getDb();
    await seedCommit(record.id, "a".repeat(40), "fix login loop", hoursAgo(5), "alice", [
      "src/auth/session.ts",
    ]);
    await db.insert(pullRequests).values({
      repositoryId: record.id,
      githubId: "gh-pr-11",
      number: 11,
      title: "Fix login",
      state: "open",
      authorLogin: "alice",
      githubCreatedAt: hoursAgo(6),
      githubUpdatedAt: hoursAgo(4),
    });
    await db.insert(issues).values({
      repositoryId: record.id,
      githubId: "gh-issue-9",
      number: 9,
      title: "Login loops",
      state: "open",
      authorLogin: "bob",
      commentsCount: 2,
      githubCreatedAt: daysAgo(2),
      githubUpdatedAt: hoursAgo(8),
    });
    const [workflow] = await db
      .insert(ciWorkflows)
      .values({ repositoryId: record.id, githubId: "100", name: "CI", state: "active" })
      .returning({ id: ciWorkflows.id });
    for (const [i, conclusion] of ["failure", "failure", "failure"].entries()) {
      await db.insert(ciRuns).values({
        repositoryId: record.id,
        workflowId: workflow.id,
        githubId: String(900 + i),
        runNumber: 900 + i,
        name: "CI",
        event: "push",
        status: "completed",
        conclusion,
        headBranch: "main",
        headSha: "a".repeat(40),
        prNumbers: [11],
        githubCreatedAt: hoursAgo(3 - i),
        githubUpdatedAt: hoursAgo(3 - i),
      });
    }

    const brief = await getEngineeringBrief(record.id, parseBriefWindow("7")!);
    expect(brief).not.toBeNull();

    // Counts derive from the same records.
    expect(brief!.counts.commits).toBe(1);
    expect(brief!.counts.contributors).toBe(1);
    expect(brief!.counts.filesChanged).toBe(1);
    expect(brief!.counts.prsOpened).toBe(1);
    expect(brief!.counts.issuesOpened).toBe(1);
    expect(brief!.counts.ciFailures).toBe(3);

    // Failures reference the failed runs (windowed streak).
    expect(brief!.failures.length).toBeGreaterThan(0);
    expect(brief!.failures.some((f) => f.entityType === "workflow")).toBe(true);

    // Incident candidate detected from the same burst.
    const detected = await detectIncidents(record.id);
    expect(detected.length).toBeGreaterThan(0);
    expect(brief!.incidents.length).toBe(detected.length);
    expect(brief!.incidents[0].entityId).toBe(detected[0].fingerprint);

    // Risks mirror the engine output (composition, not duplication).
    const report = await analyzeRepositoryRisks(record.id);
    expect(brief!.risks.map((r) => r.entityId).sort()).toEqual(
      report.findings.slice(0, 8).map((f) => f.id).sort(),
    );

    // Relationships only traverse observed records.
    expect(brief!.relationships.length).toBeGreaterThan(0);
    for (const rel of brief!.relationships) {
      expect(rel.path.length).toBeGreaterThanOrEqual(2);
    }

    // Every evidenceIds reference resolves in the evidence index.
    const validIds = new Set(brief!.evidence.map((e) => e.id));
    const checkIds = (ids: string[], where: string) => {
      for (const id of ids) {
        expect(validIds.has(id), `${where} references missing evidence ${id}`).toBe(true);
      }
    };
    for (const section of [
      brief!.whatChanged,
      brief!.failures,
      brief!.incidents,
      brief!.risks,
      brief!.pullRequests,
      brief!.issues,
      brief!.investigationNextSteps,
    ]) {
      for (const item of section) {
        checkIds(item.evidenceIds, item.title);
        expect(item.evidenceIds.length).toBeGreaterThan(0);
      }
    }
    for (const rel of brief!.relationships) {
      checkIds(rel.evidenceIds, rel.description);
    }

    // No causality or impact language in deterministic output. (The
    // unknowns list must still state that root cause is NOT established.)
    expect(JSON.stringify(brief)).not.toMatch(/caused (the|this|a) failure/i);
    expect(JSON.stringify(brief)).not.toMatch(/root cause is (known|established|identified)/i);
    expect(JSON.stringify(brief.unknowns.join(" "))).toMatch(/Root cause is not established/);
    expect(JSON.stringify(brief)).not.toMatch(/production (is healthy|outage)|customers (were|are) affected|revenue/i);
  });

  it("is deterministic across calls (except generation timestamp)", async () => {
    const { record } = await setupRepo();
    await seedCommit(record.id, "a".repeat(40), "work", hoursAgo(2));
    const window = parseBriefWindow("7")!;
    const first = await getEngineeringBrief(record.id, window);
    const second = await getEngineeringBrief(record.id, window);
    const { generatedAt: _a, ...restA } = first!;
    const { generatedAt: _b, ...restB } = second!;
    expect(restA).toEqual(restB);
    // Evidence fingerprint of the package is stable.
    const { fingerprintBriefEvidence } = await import("../brief.service.js");
    expect(fingerprintBriefEvidence(JSON.stringify(restA))).toBe(
      fingerprintBriefEvidence(JSON.stringify(restB)),
    );
  });

  it("deduplicates evidence by canonical id", async () => {
    const { record } = await setupRepo();
    await seedCommit(record.id, "a".repeat(40), "work", hoursAgo(2), "alice", [
      "src/app.ts",
    ]);
    const brief = await getEngineeringBrief(record.id, parseBriefWindow("7")!);
    const ids = brief!.evidence.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every referenced file even beyond the display cap", async () => {
    const { record } = await setupRepo();
    // Fifteen files fill the top-N window-files cap; a second commit touches
    // files sorting after the cap, which per-claim slices still reference.
    const capped = Array.from({ length: 15 }, (_, i) => `src/part-${String(i).padStart(2, "0")}.ts`);
    await seedCommit(record.id, "a".repeat(40), "big change", hoursAgo(3), "alice", capped);
    const beyond = Array.from({ length: 5 }, (_, i) => `src/zebra-${String(i).padStart(2, "0")}.ts`);
    await seedCommit(record.id, "b".repeat(40), "more change", hoursAgo(2), "alice", beyond);
    const brief = await getEngineeringBrief(record.id, parseBriefWindow("7")!);
    const validIds = new Set(brief!.evidence.map((e) => e.id));
    for (const item of brief!.whatChanged) {
      for (const id of item.evidenceIds) {
        expect(validIds.has(id), `dangling reference ${id}`).toBe(true);
      }
    }
    // The beyond-cap files resolved through the backstop, not the top-N loop.
    for (const path of beyond) {
      expect(validIds.has(`file:${path}`), `missing ${path}`).toBe(true);
    }
  });

  it("isolates repositories", async () => {
    const first = await setupRepo();
    const second = await setupRepo();
    await seedCommit(first.record.id, "a".repeat(40), "work", hoursAgo(2));
    const a = await getEngineeringBrief(first.record.id, parseBriefWindow("7")!);
    const b = await getEngineeringBrief(second.record.id, parseBriefWindow("7")!);
    expect(a!.counts.commits).toBe(1);
    expect(b!.counts.commits).toBe(0);
    expect(b!.whatChanged).toEqual([]);
  });
});
