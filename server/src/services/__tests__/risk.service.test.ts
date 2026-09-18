import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  analyzeRepositoryRisks,
  RISK_THRESHOLDS,
  type RiskFinding,
} from "../risk.service.js";
import { createRepository } from "../repository.service.js";
import { getDb } from "../../db/index.js";
import { commits, commitFiles, repositories } from "../../db/schema.js";

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

interface SeedCommit {
  sha: string;
  message: string;
  login?: string;
  daysAgo: number;
  files?: Array<{ path: string; additions?: number; deletions?: number }>;
}

async function seedRepo(seedCommits: SeedCommit[]): Promise<string> {
  const suffix = uniqueSuffix();
  const db = getDb();
  const record = await createRepository({
    githubId: `gh-risk-${suffix}`,
    owner: "o",
    name: `risk-${suffix}`,
    fullName: `o/risk-${suffix}`,
  });

  for (const [index, seed] of seedCommits.entries()) {
    const [commit] = await db
      .insert(commits)
      .values({
        repositoryId: record.id,
        sha: seed.sha,
        message: seed.message,
        authorLogin: seed.login ?? "alice",
        committedAt: daysAgo(seed.daysAgo),
      })
      .returning({ id: commits.id });
    for (const file of seed.files ?? []) {
      await db.insert(commitFiles).values({
        commitId: commit.id,
        repositoryId: record.id,
        path: file.path,
        status: "modified",
        additions: file.additions ?? 1,
        deletions: file.deletions ?? 0,
      });
    }
    void index;
  }
  return record.id;
}

const sha = (ch: string, salt = "") => `${ch.repeat(38)}${salt.padEnd(2, "0")}`.slice(0, 40);

function withoutGeneratedAt(report: Awaited<ReturnType<typeof analyzeRepositoryRisks>>) {
  const { generatedAt: _generated, ...rest } = report;
  void _generated;
  return rest;
}

describe("Risk engine detectors", () => {
  beforeEach(() => {
    setupEnv();
  });

  it("returns a valid empty report for a repository with no data", async () => {
    const suffix = uniqueSuffix();
    const record = await createRepository({
      githubId: `gh-risk-empty-${suffix}`,
      owner: "o",
      name: `empty-${suffix}`,
      fullName: `o/empty-${suffix}`,
    });

    const report = await analyzeRepositoryRisks(record.id);

    expect(report.summary).toEqual({ total: 0, critical: 0, high: 0, medium: 0, low: 0 });
    expect(report.findings).toEqual([]);
    expect(report.analysisWindow.value).toBe(RISK_THRESHOLDS.windowDays);
    expect(report.analysisWindow.start < report.analysisWindow.end).toBe(true);
  });

  it("ignores activity outside the analysis window", async () => {
    const repositoryId = await seedRepo([
      { sha: sha("a"), message: "fix ancient bug", daysAgo: 90, files: [{ path: "old.ts" }] },
    ]);

    const report = await analyzeRepositoryRisks(repositoryId);
    expect(report.findings).toEqual([]);
  });

  it("detects hot files with severity tiers and stable fingerprints", async () => {
    const repositoryId = await seedRepo(
      Array.from({ length: 6 }, (_, i) => ({
        sha: sha("b", String(i)),
        message: `refactor part ${i}`,
        daysAgo: 5,
        files: [{ path: "src/hot.ts" }],
      })),
    );

    const first = await analyzeRepositoryRisks(repositoryId);
    const hot = first.findings.filter((f) => f.type === "hot_file");
    expect(hot).toHaveLength(1);
    expect(hot[0].severity).toBe("medium");
    expect(hot[0].affectedFiles).toEqual(["src/hot.ts"]);
    expect(
      hot[0].evidence.find((e) => e.label === "Distinct commits touching file")?.value,
    ).toBe("6");

    // Deterministic: same DB state → identical findings and fingerprints.
    const second = await analyzeRepositoryRisks(repositoryId);
    expect(withoutGeneratedAt(second)).toEqual(withoutGeneratedAt(first));
  });

  it("escalates very hot files to high and critical", async () => {
    const highId = await seedRepo(
      Array.from({ length: 12 }, (_, i) => ({
        sha: sha("c", String(i).padStart(2, "0")),
        message: `tweak ${i}`,
        daysAgo: 4,
        files: [{ path: "src/high.ts" }],
      })),
    );
    const high = (await analyzeRepositoryRisks(highId)).findings.find(
      (f) => f.type === "hot_file",
    );
    expect(high?.severity).toBe("high");

    const criticalId = await seedRepo(
      Array.from({ length: 22 }, (_, i) => ({
        sha: sha("d", String(i).padStart(2, "0")),
        message: `tweak ${i}`,
        daysAgo: 3,
        files: [{ path: "src/critical.ts" }],
      })),
    );
    const critical = (await analyzeRepositoryRisks(criticalId)).findings.find(
      (f) => f.type === "hot_file",
    );
    expect(critical?.severity).toBe("critical");
  });

  it("detects file churn from stored line counts", async () => {
    const repositoryId = await seedRepo([
      {
        sha: sha("e"),
        message: "big rewrite",
        daysAgo: 2,
        files: [{ path: "src/churn.ts", additions: 400, deletions: 200 }],
      },
    ]);

    const report = await analyzeRepositoryRisks(repositoryId);
    const churn = report.findings.filter((f) => f.type === "file_churn");
    expect(churn).toHaveLength(1);
    expect(churn[0].severity).toBe("medium");
    expect(
      churn[0].evidence.find((e) => e.label === "Lines added+deleted")?.value,
    ).toBe("600");
  });

  it("detects change concentration with shares and top files", async () => {
    const repositoryId = await seedRepo([
      ...Array.from({ length: 12 }, (_, i) => ({
        sha: sha("f", String(i).padStart(2, "0")),
        message: `auth work ${i}`,
        daysAgo: 6,
        files: [{ path: "src/auth/session.ts" }],
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        sha: sha("0", String(i).padStart(2, "0")),
        message: `docs ${i}`,
        daysAgo: 6,
        files: [{ path: `docs/page${i}.md` }],
      })),
    ]);

    const report = await analyzeRepositoryRisks(repositoryId);
    const concentration = report.findings.filter(
      (f) => f.type === "change_concentration",
    );
    expect(concentration).toHaveLength(1);
    expect(concentration[0].title).toContain("src/");
    // 12 of 16 events = 75% → high.
    expect(concentration[0].severity).toBe("high");
    expect(
      concentration[0].evidence.find((e) => e.label === "Share of all observed changes")
        ?.value,
    ).toBe("75%");
  });

  it("detects contributor concentration without ranking anyone", async () => {
    const repositoryId = await seedRepo([
      ...Array.from({ length: 8 }, (_, i) => ({
        sha: sha("1", String(i).padStart(2, "0")),
        message: `alice work ${i}`,
        login: "alice",
        daysAgo: 5,
        files: [{ path: "src/solo.ts" }],
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        sha: sha("2", String(i).padStart(2, "0")),
        message: `bob work ${i}`,
        login: "bob",
        daysAgo: 5,
        files: [{ path: "src/solo.ts" }],
      })),
    ]);

    const report = await analyzeRepositoryRisks(repositoryId);
    const concentration = report.findings.filter(
      (f) => f.type === "contributor_concentration",
    );
    expect(concentration).toHaveLength(1);
    // 8/10 = 80% → medium (>=75%, <90%).
    expect(concentration[0].severity).toBe("medium");
    expect(concentration[0].summary).not.toMatch(/best|rank|score|productiv/i);
    expect(concentration[0].affectedContributors).toEqual(
      expect.arrayContaining(["alice", "bob"]),
    );
  });

  it("detects corrective activity with count-based severity", async () => {
    const repositoryId = await seedRepo([
      { sha: sha("3"), message: "fix login redirect", daysAgo: 2, files: [{ path: "a.ts" }] },
      { sha: sha("4"), message: "patch session expiry", daysAgo: 2, files: [{ path: "b.ts" }] },
      { sha: sha("5"), message: "add feature", daysAgo: 2, files: [{ path: "c.ts" }] },
    ]);

    const report = await analyzeRepositoryRisks(repositoryId);
    const corrective = report.findings.filter((f) => f.type === "corrective_activity");
    expect(corrective).toHaveLength(1);
    expect(corrective[0].severity).toBe("medium");
    expect(corrective[0].relatedCommits).toHaveLength(2);
    expect(corrective[0].summary).toMatch(/defect-driven churn, not a confirmed defect/);
  });

  it("does not match substrings like 'prefix' as corrective", async () => {
    const repositoryId = await seedRepo([
      { sha: sha("6"), message: "prefix wiring for config", daysAgo: 2, files: [{ path: "a.ts" }] },
    ]);

    const report = await analyzeRepositoryRisks(repositoryId);
    expect(report.findings.filter((f) => f.type === "corrective_activity")).toHaveLength(0);
  });

  it("detects revert declarations as their own signal", async () => {
    const repositoryId = await seedRepo([
      { sha: sha("7"), message: 'Revert "add risky migration"', daysAgo: 1, files: [{ path: "db.ts" }] },
    ]);

    const report = await analyzeRepositoryRisks(repositoryId);
    const reverts = report.findings.filter((f) => f.type === "revert_activity");
    expect(reverts).toHaveLength(1);
    expect(reverts[0].severity).toBe("medium");
  });

  it("detects velocity bursts against the baseline", async () => {
    const repositoryId = await seedRepo([
      ...Array.from({ length: 6 }, (_, i) => ({
        sha: sha("8", String(i).padStart(2, "0")),
        message: `burst ${i}`,
        daysAgo: 1,
        files: [{ path: `burst${i}.ts` }],
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        sha: sha("9", String(i).padStart(2, "0")),
        message: `steady ${i}`,
        daysAgo: 40,
        files: [{ path: `steady${i}.ts` }],
      })),
    ]);

    const report = await analyzeRepositoryRisks(repositoryId);
    const velocity = report.findings.filter((f) => f.type === "change_velocity");
    expect(velocity).toHaveLength(1);
    expect(velocity[0].severity).toBe("medium");
  });

  it("orders findings deterministically by severity then type", async () => {
    const repositoryId = await seedRepo([
      ...Array.from({ length: 6 }, (_, i) => ({
        sha: sha("a", `o${i}`),
        message: `fix hot ${i}`,
        daysAgo: 2,
        files: [{ path: "src/hot.ts" }],
      })),
    ]);

    const report = await analyzeRepositoryRisks(repositoryId);
    const severities = report.findings.map((f) => f.severity);
    const rank = (s: string) => ({ critical: 0, high: 1, medium: 2, low: 3 })[s] ?? 9;
    const sorted = [...severities].sort((a, b) => rank(a) - rank(b));
    expect(severities).toEqual(sorted);
    expect(report.summary.total).toBe(report.findings.length);
  });

  it("every finding carries evidence, recommendation, and fingerprint", async () => {
    const repositoryId = await seedRepo([
      {
        sha: sha("b"),
        message: "fix the thing",
        daysAgo: 2,
        files: [{ path: "x.ts" }],
      },
    ]);

    const report = await analyzeRepositoryRisks(repositoryId);
    expect(report.findings.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const finding of report.findings as RiskFinding[]) {
      expect(finding.id).toMatch(/^v1:/);
      ids.add(finding.id);
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.recommendation.length).toBeGreaterThan(0);
      expect(finding.detectedAt).toBeInstanceOf(Date);
    }
    expect(ids.size).toBe(report.findings.length);
  });

  it("stores nothing: analysis is computed, repositories table untouched", async () => {
    const repositoryId = await seedRepo([
      { sha: sha("c"), message: "fix x", daysAgo: 2, files: [{ path: "x.ts" }] },
    ]);
    const db = getDb();

    await analyzeRepositoryRisks(repositoryId);
    await analyzeRepositoryRisks(repositoryId);

    const rows = await db
      .select({ syncStatus: repositories.syncStatus })
      .from(repositories)
      .where(eq(repositories.id, repositoryId));
    expect(rows[0].syncStatus).toBe("idle");
  });
});
