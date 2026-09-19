import { describe, it, expect, beforeEach } from "vitest";
import {
  failureStreakLength,
  failuresInWindow,
  getCiSummary,
  getRunDetail,
  listRuns,
  listWorkflows,
  successRate,
} from "../ci-intelligence.service.js";
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
  issuePrLinks,
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

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const SHA = (ch: string) => ch.repeat(40);

async function setupRepo() {
  const suffix = uniqueSuffix();
  const login = await handleGithubIdentity(
    {
      githubId: `gh-cii-${suffix}`,
      login: `cii-${suffix}`,
      name: null,
      email: null,
      avatarUrl: null,
    },
    { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
  );
  const record = await createRepository({
    githubId: `gh-cii-repo-${suffix}`,
    owner: "o",
    name: `r-${suffix}`,
    fullName: `o/r-${suffix}`,
  });
  await linkUserRepository(login.user.id, record.id, "owner");
  return record;
}

async function addWorkflow(repositoryId: string, githubId = "100", name = "CI") {
  const db = getDb();
  const [row] = await db
    .insert(ciWorkflows)
    .values({ repositoryId, githubId, name, path: ".github/workflows/ci.yml", state: "active" })
    .returning();
  return row;
}

async function addRun(
  repositoryId: string,
  workflowId: string,
  seed: {
    githubId: string;
    runNumber?: number;
    status?: string | null;
    conclusion?: string | null;
    branch?: string | null;
    sha?: string | null;
    hoursAgo?: number;
    durationSec?: number | null;
    prNumbers?: number[];
  },
) {
  const db = getDb();
  const created = seed.hoursAgo !== undefined ? hoursAgo(seed.hoursAgo) : hoursAgo(1);
  const [row] = await db
    .insert(ciRuns)
    .values({
      repositoryId,
      workflowId,
      githubId: seed.githubId,
      runNumber: seed.runNumber ?? Number(seed.githubId),
      name: "CI",
      event: "push",
      status: seed.status ?? "completed",
      conclusion: seed.conclusion ?? "success",
      headBranch: seed.branch ?? "main",
      headSha: seed.sha ?? SHA("a"),
      runAttempt: 1,
      actorLogin: "alice",
      prNumbers: seed.prNumbers ?? [],
      durationSec: seed.durationSec ?? 120,
      githubCreatedAt: created,
      githubUpdatedAt: created,
      startedAt: created,
      completedAt: seed.status === "in_progress" ? null : created,
    })
    .returning();
  return row;
}

describe("CI deterministic helpers", () => {
  it("computes streaks over newest-first runs, skipping running ones", () => {
    const run = (status: string | null, conclusion: string | null) =>
      ({ status, conclusion }) as never;
    expect(failureStreakLength([run("completed", "failure"), run("completed", "failure")])).toBe(2);
    expect(
      failureStreakLength([run("in_progress", null), run("completed", "failure")]),
    ).toBe(1);
    expect(
      failureStreakLength([run("completed", "failure"), run("completed", "success")]),
    ).toBe(1);
    expect(failureStreakLength([run("completed", "cancelled")])).toBe(0);
    expect(failuresInWindow([run("completed", "failure"), run("completed", "success")], 10)).toBe(1);
  });

  it("computes success rate excluding cancelled/skips/running", () => {
    expect(successRate([])).toBeNull();
    expect(
      successRate([
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "failure" },
        { status: "completed", conclusion: "cancelled" },
        { status: "completed", conclusion: "skipped" },
        { status: "in_progress", conclusion: null },
      ]),
    ).toBe(0.5);
    expect(
      successRate([
        { status: "completed", conclusion: "cancelled" },
        { status: "completed", conclusion: "neutral" },
      ]),
    ).toBeNull();
    expect(
      successRate([
        { status: "completed", conclusion: "timed_out" },
        { status: "completed", conclusion: "success" },
      ]),
    ).toBe(0.5);
  });
});

describe("CI intelligence", () => {
  beforeEach(() => {
    setupEnv();
  });

  it("returns empty summaries when no CI data exists", async () => {
    const repo = await setupRepo();
    const summary = await getCiSummary(repo.id);
    expect(summary.counts).toMatchObject({ workflows: 0, runs: 0, successRate: null });
    expect(summary.signals).toEqual([]);
    expect(summary.prCiStates).toEqual([]);
    expect(await listWorkflows(repo.id)).toEqual([]);
    expect((await listRuns(repo.id)).data).toEqual([]);
    expect(await getRunDetail(repo.id, "1")).toBeNull();
  });

  it("detects failure streaks with escalating severity", async () => {
    const repo = await setupRepo();
    const wf = await addWorkflow(repo.id);
    await addRun(repo.id, wf.id, { githubId: "1", conclusion: "failure", hoursAgo: 5 });
    await addRun(repo.id, wf.id, { githubId: "2", conclusion: "failure", hoursAgo: 3 });
    await addRun(repo.id, wf.id, { githubId: "3", conclusion: "failure", hoursAgo: 1 });

    const summary = await getCiSummary(repo.id);
    expect(summary.failureStreaks).toEqual([
      { workflowGithubId: "100", workflowName: "CI", streak: 3, lastRunGithubId: expect.any(String) },
    ]);
    const streak = summary.signals.find((s) => s.type === "failure_streak");
    expect(streak?.severity).toBe("medium");
    expect(summary.counts).toMatchObject({ failed: 3, successRate: 0 });
  });

  it("detects unstable oscillation and recovery as distinct contexts", async () => {
    const repo = await setupRepo();
    const wf = await addWorkflow(repo.id);
    // Alternating history: 4 failures in the last 10 → unstable.
    const conclusions = ["failure", "success", "failure", "success", "failure", "success", "failure", "success"];
    let hour = 20;
    for (const [i, conclusion] of conclusions.entries()) {
      await addRun(repo.id, wf.id, { githubId: `${10 + i}`, runNumber: 10 + i, conclusion, hoursAgo: hour });
      hour -= 1;
    }
    // Latest run succeeds after failures → recovered + unstable both fire.
    await addRun(repo.id, wf.id, { githubId: "99", runNumber: 99, conclusion: "success", hoursAgo: 0 });

    const summary = await getCiSummary(repo.id);
    expect(summary.unstableWorkflows).toHaveLength(1);
    expect(summary.unstableWorkflows[0]).toMatchObject({ failures: 4, window: 10 });
    expect(summary.recovered).toHaveLength(0); // newest is success but streak broken pattern differs
    const types = summary.signals.map((s) => s.type);
    expect(types).toContain("unstable");
  });

  it("reports recovery when success follows a streak", async () => {
    const repo = await setupRepo();
    const wf = await addWorkflow(repo.id);
    await addRun(repo.id, wf.id, { githubId: "1", conclusion: "failure", hoursAgo: 3 });
    await addRun(repo.id, wf.id, { githubId: "2", conclusion: "failure", hoursAgo: 2 });
    await addRun(repo.id, wf.id, { githubId: "3", conclusion: "success", hoursAgo: 1 });

    const summary = await getCiSummary(repo.id);
    expect(summary.recovered).toEqual([
      { workflowGithubId: "100", workflowName: "CI", afterStreak: 2 },
    ]);
    expect(summary.signals.some((s) => s.type === "recovered")).toBe(true);
    expect(summary.failureStreaks).toEqual([]);
  });

  it("flags stale running and long completed runs distinctly", async () => {
    const repo = await setupRepo();
    const wf = await addWorkflow(repo.id);
    await addRun(repo.id, wf.id, {
      githubId: "1",
      status: "in_progress",
      conclusion: null,
      hoursAgo: 2,
    });
    await addRun(repo.id, wf.id, {
      githubId: "2",
      conclusion: "success",
      hoursAgo: 5,
      durationSec: 3600,
    });

    const summary = await getCiSummary(repo.id);
    expect(summary.staleRuns.map((r) => r.githubId)).toEqual(["1"]);
    expect(summary.signals.some((s) => s.type === "stale_running")).toBe(true);
    expect(summary.signals.some((s) => s.type === "long_running")).toBe(true);
    // Stale is not failure.
    expect(summary.counts.failed).toBe(0);
  });

  it("attributes branch failure context neutrally", async () => {
    const repo = await setupRepo();
    const wf = await addWorkflow(repo.id);
    await addRun(repo.id, wf.id, { githubId: "1", conclusion: "failure", branch: "main", hoursAgo: 3 });
    await addRun(repo.id, wf.id, { githubId: "2", conclusion: "failure", branch: "main", hoursAgo: 2 });
    await addRun(repo.id, wf.id, { githubId: "3", conclusion: "success", branch: "feature", hoursAgo: 1 });

    const summary = await getCiSummary(repo.id);
    const branch = summary.signals.find((s) => s.type === "branch_failures");
    expect(branch?.title).toContain("main");
    expect(branch?.title).toMatch(/failures observed on branch/);
    expect(branch?.detail).toMatch(/not a claim that the branch itself is broken/);
  });

  it("correlates runs to PRs and reports PR CI states", async () => {
    const repo = await setupRepo();
    const db = getDb();
    const wf = await addWorkflow(repo.id);
    await db.insert(pullRequests).values({
      repositoryId: repo.id,
      githubId: "gh-pr-219",
      number: 219,
      title: "Fix loop",
      state: "open",
      headSha: SHA("b"),
    });
    await addRun(repo.id, wf.id, {
      githubId: "50",
      conclusion: "failure",
      sha: SHA("b"),
      prNumbers: [219],
      hoursAgo: 1,
    });

    const summary = await getCiSummary(repo.id);
    expect(summary.prCiStates).toEqual([
      {
        prNumber: 219,
        prTitle: "Fix loop",
        state: "failed",
        runGithubId: "50",
        workflowName: "CI",
        conclusion: "failure",
      },
    ]);
    expect(summary.signals.some((s) => s.type === "pr_ci_failure")).toBe(true);
  });

  it("builds run detail across commit, files, risks, and issues", async () => {
    const repo = await setupRepo();
    const db = getDb();
    const wf = await addWorkflow(repo.id);
    // Hot-file risk: 5 window commits on one path.
    for (let i = 0; i < 5; i++) {
      const [commit] = await db
        .insert(commits)
        .values({
          repositoryId: repo.id,
          sha: `${String(i).repeat(38)}${String(i).padStart(2, "0")}`.slice(0, 40),
          message: `tweak ${i}`,
          authorLogin: "bob",
          committedAt: daysAgo(i + 1),
        })
        .returning({ id: commits.id });
      await db.insert(commitFiles).values({
        commitId: commit.id,
        repositoryId: repo.id,
        path: "src/payment/retry.ts",
        status: "modified",
      });
    }
    const [linkedCommit] = await db
      .insert(commits)
      .values({
        repositoryId: repo.id,
        sha: SHA("c"),
        message: "fix retry",
        authorLogin: "bob",
        committedAt: daysAgo(0),
      })
      .returning({ id: commits.id, sha: commits.sha });
    await db.insert(commitFiles).values({
      commitId: linkedCommit.id,
      repositoryId: repo.id,
      path: "src/payment/retry.ts",
      status: "modified",
    });
    const [pr] = await db
      .insert(pullRequests)
      .values({
        repositoryId: repo.id,
        githubId: "gh-pr-81",
        number: 81,
        title: "Retry fix",
        state: "closed",
        merged: true,
        headSha: SHA("c"),
      })
      .returning({ id: pullRequests.id });
    const [issue] = await db
      .insert(issues)
      .values({
        repositoryId: repo.id,
        githubId: "gh-issue-42",
        number: 42,
        title: "Retry flakes",
        state: "open",
      })
      .returning({ id: issues.id });
    await db.insert(issuePrLinks).values({
      issueId: issue.id,
      pullRequestId: pr.id,
      repositoryId: repo.id,
      relation: "closed_by",
      evidence: "pr-body:81:fixes #42",
    });
    await addRun(repo.id, wf.id, {
      githubId: "812",
      conclusion: "failure",
      sha: SHA("c"),
      prNumbers: [81],
      hoursAgo: 1,
    });

    const detail = await getRunDetail(repo.id, "812");
    expect(detail?.commit?.sha).toBe(SHA("c"));
    expect(detail?.linkedPrs).toEqual([
      { number: 81, title: "Retry fix", state: "closed", merged: true, via: "github-association" },
    ]);
    expect(detail?.files.map((f) => f.path)).toEqual(["src/payment/retry.ts"]);
    expect(detail?.riskFindings.length).toBeGreaterThan(0);
    expect(detail?.relatedIssues).toEqual([{ number: 42, title: "Retry flakes", state: "open" }]);
    expect(detail?.signals.map((s) => s.type)).toContain("run_failed");
    expect(detail?.signals.map((s) => s.type)).toContain("risk_overlap");
    // Association language only.
    expect(JSON.stringify(detail?.signals)).not.toMatch(/caused/i);
  });

  it("computes identical summaries deterministically", async () => {
    const repo = await setupRepo();
    const wf = await addWorkflow(repo.id);
    await addRun(repo.id, wf.id, { githubId: "1", conclusion: "failure", hoursAgo: 2 });

    const first = await getCiSummary(repo.id);
    const second = await getCiSummary(repo.id);
    expect(second.signals.map((s) => `${s.type}:${s.title}`)).toEqual(
      first.signals.map((s) => `${s.type}:${s.title}`),
    );
    expect(second.counts).toEqual(first.counts);
  });

  it("filters and paginates runs with repository isolation", async () => {
    const repo = await setupRepo();
    const other = await setupRepo();
    const wf = await addWorkflow(repo.id);
    const wfOther = await addWorkflow(other.id, "100", "CI");
    await addRun(repo.id, wf.id, { githubId: "1", conclusion: "failure", branch: "main", hoursAgo: 2 });
    await addRun(repo.id, wf.id, { githubId: "2", conclusion: "success", branch: "feature", hoursAgo: 1 });
    await addRun(other.id, wfOther.id, { githubId: "1", conclusion: "failure", hoursAgo: 1 });

    expect(
      (await listRuns(repo.id, { conclusion: "failure" })).data.map((r) => r.githubId),
    ).toEqual(["1"]);
    expect(
      (await listRuns(repo.id, { branch: "feature" })).data.map((r) => r.githubId),
    ).toEqual(["2"]);
    const paged = await listRuns(repo.id, { page: 2, perPage: 1 });
    expect(paged.pagination).toMatchObject({ page: 2, perPage: 1, total: 2 });
    expect((await listRuns(other.id)).data.map((r) => r.githubId)).toEqual(["1"]);
  });
});
