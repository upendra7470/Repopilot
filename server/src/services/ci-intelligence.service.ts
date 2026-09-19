import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/index.js";
import {
  ciJobs,
  ciRuns,
  ciWorkflows,
  commits,
  commitFiles,
  issuePrLinks,
  issues,
  pullRequests,
} from "../db/schema.js";
import {
  analyzeRepositoryRisks,
  isCorrectiveMessage,
  RISK_THRESHOLDS,
} from "./risk.service.js";
import { getLogger } from "../utils/logger.js";

/**
 * Deterministic CI intelligence (Phase 10, no LLM).
 *
 * Every signal is computed from persisted Actions records with explicit
 * thresholds below. Correlation is never causation: failures are reported
 * as "associated with commit/PR/files", never as "caused by". Unknown
 * stays unknown — silence is not success.
 */

export const CI_THRESHOLDS = {
  /** Consecutive terminal failures that form a streak. */
  failureStreakMin: 2,
  /** Streak length that escalates severity. */
  failureStreakHigh: 5,
  /** Completed runs examined per workflow for instability. */
  unstableWindowRuns: 10,
  /** Failures within the window that mark a workflow unstable. */
  unstableMinFailures: 4,
  /** Completed-run duration that counts as long-running. */
  longRunMinutes: 30,
  /** Non-terminal age that counts as a stale run. */
  staleRunningMinutes: 30,
  /** Recent failures on one branch that form branch context. */
  branchFailureMin: 2,
  /** Recent runs examined for branch/recent-failure context. */
  recentWindowRuns: 50,
  /** Recent failures surfaced in the summary. */
  recentFailuresShown: 5,
  defaultPerPage: 20,
  maxPerPage: 50,
} as const;

/** Terminal conclusions counted as failures (not cancellations/skips). */
export const FAILURE_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "startup_failure",
]);
const SUCCESS_CONCLUSION = "success";
/** Conclusions excluded from the success-rate denominator entirely. */
const EXCLUDED_FROM_RATE = new Set([
  "cancelled",
  "skipped",
  "neutral",
  "action_required",
  "stale",
]);

export type CiSeverity = "info" | "low" | "medium" | "high";

export interface CiSignalEvidence {
  label: string;
  value: string;
}

export interface CiSignal {
  type: string;
  severity: CiSeverity;
  title: string;
  detail: string;
  evidence: CiSignalEvidence[];
}

export interface WorkflowRecord {
  id: string;
  repositoryId: string;
  githubId: string;
  name: string | null;
  path: string | null;
  state: string | null;
  badgeUrl: string | null;
  htmlUrl: string | null;
  githubCreatedAt: Date | null;
  githubUpdatedAt: Date | null;
}

export interface RunRecord {
  id: string;
  repositoryId: string;
  workflowId: string;
  githubId: string;
  runNumber: number | null;
  name: string | null;
  event: string | null;
  status: string | null;
  conclusion: string | null;
  headBranch: string | null;
  headSha: string | null;
  runAttempt: number | null;
  actorLogin: string | null;
  prNumbers: number[];
  htmlUrl: string | null;
  durationSec: number | null;
  githubCreatedAt: Date | null;
  githubUpdatedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface JobRecord {
  githubId: string;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationSec: number | null;
  htmlUrl: string | null;
}

export interface WorkflowSummary {
  workflow: WorkflowRecord;
  active: boolean;
  lastRun: RunRecord | null;
  recentFailures: number;
  failureStreak: number;
  unstable: boolean;
}

export interface PrCiState {
  prNumber: number;
  prTitle: string | null;
  state: "failed" | "passing" | "running" | "unknown";
  runGithubId: string | null;
  workflowName: string | null;
  conclusion: string | null;
}

export interface CiSummaryCounts {
  workflows: number;
  activeWorkflows: number;
  runs: number;
  running: number;
  completed: number;
  success: number;
  failed: number;
  other: number;
  /** success / (success + failure + timed_out + startup_failure); null when denominator is 0. */
  successRate: number | null;
}

export interface CiSummary {
  counts: CiSummaryCounts;
  signals: CiSignal[];
  failureStreaks: Array<{ workflowGithubId: string; workflowName: string | null; streak: number; lastRunGithubId: string }>;
  unstableWorkflows: Array<{ workflowGithubId: string; workflowName: string | null; failures: number; window: number }>;
  recentFailures: Array<RunRecord & { workflowName: string | null }>;
  staleRuns: Array<RunRecord & { workflowName: string | null }>;
  recovered: Array<{ workflowGithubId: string; workflowName: string | null; afterStreak: number }>;
  prCiStates: PrCiState[];
  lastFailureAt: Date | null;
}

export interface RunDetail {
  run: RunRecord;
  workflow: WorkflowRecord | null;
  jobs: JobRecord[];
  commit: { sha: string; message: string | null; authorLogin: string | null } | null;
  linkedPrs: Array<{ number: number; title: string | null; state: string; merged: boolean; via: string }>;
  files: Array<{ path: string; windowChanges: number; hot: boolean }>;
  riskFindings: Array<{ id: string; type: string; severity: string; title: string }>;
  relatedIssues: Array<{ number: number; title: string | null; state: string }>;
  signals: CiSignal[];
}

export interface RunListFilters {
  workflow?: string;
  branch?: string;
  status?: string;
  conclusion?: string;
  pr?: number;
  page?: number;
  perPage?: number;
}

export interface RunListPage {
  data: Array<RunRecord & { workflowName: string | null; linkedPrs: number[] }>;
  pagination: { page: number; perPage: number; total: number };
}

type RunRow = typeof ciRuns.$inferSelect;
type WorkflowRow = typeof ciWorkflows.$inferSelect;

function toWorkflowRecord(row: WorkflowRow): WorkflowRecord {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    githubId: row.githubId,
    name: row.name,
    path: row.path,
    state: row.state,
    badgeUrl: row.badgeUrl,
    htmlUrl: row.htmlUrl,
    githubCreatedAt: row.githubCreatedAt,
    githubUpdatedAt: row.githubUpdatedAt,
  };
}

function toRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    workflowId: row.workflowId,
    githubId: row.githubId,
    runNumber: row.runNumber,
    name: row.name,
    event: row.event,
    status: row.status,
    conclusion: row.conclusion,
    headBranch: row.headBranch,
    headSha: row.headSha,
    runAttempt: row.runAttempt,
    actorLogin: row.actorLogin,
    prNumbers: row.prNumbers ?? [],
    htmlUrl: row.htmlUrl,
    durationSec: row.durationSec,
    githubCreatedAt: row.githubCreatedAt,
    githubUpdatedAt: row.githubUpdatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function isTerminal(run: { status: string | null }): boolean {
  return run.status === "completed";
}

function isFailure(run: { status: string | null; conclusion: string | null }): boolean {
  return run.status === "completed" && run.conclusion !== null && FAILURE_CONCLUSIONS.has(run.conclusion);
}

function isSuccess(run: { status: string | null; conclusion: string | null }): boolean {
  return run.status === "completed" && run.conclusion === SUCCESS_CONCLUSION;
}

function runTime(run: { githubCreatedAt: Date | null }): number {
  const ms = run.githubCreatedAt?.getTime() ?? Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/** Newest-first ordering shared by every signal computation. */
function newestFirst<T extends { githubCreatedAt: Date | null }>(runs: T[]): T[] {
  return [...runs].sort((a, b) => runTime(b) - runTime(a));
}

/**
 * Consecutive terminal failures from the newest run. Non-terminal runs do
 * not break a streak (a running retry is not evidence either way); the
 * first success — or any other terminal conclusion — ends it.
 */
export function failureStreakLength(runsNewestFirst: RunRow[] | RunRecord[]): number {
  let streak = 0;
  for (const run of runsNewestFirst) {
    if (!isTerminal(run)) {
      continue;
    }
    if (isFailure(run)) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

/** Failures among the last N completed runs (window counts completed only). */
export function failuresInWindow(runsNewestFirst: RunRow[] | RunRecord[], window: number): number {
  let failures = 0;
  let seen = 0;
  for (const run of runsNewestFirst) {
    if (!isTerminal(run)) {
      continue;
    }
    seen += 1;
    if (seen > window) {
      break;
    }
    if (isFailure(run)) {
      failures += 1;
    }
  }
  return failures;
}

/**
 * Transparent success rate. Numerator: success conclusions. Denominator:
 * success + failure-class conclusions. Cancelled/skipped/neutral/
 * action_required/stale and non-terminal runs are excluded — they are not
 * evidence of delivery health either way. Null when nothing qualifies.
 */
export function successRate(runs: Array<{ status: string | null; conclusion: string | null }>): number | null {
  let success = 0;
  let failed = 0;
  for (const run of runs) {
    if (!isTerminal(run) || run.conclusion === null) {
      continue;
    }
    if (run.conclusion === SUCCESS_CONCLUSION) {
      success += 1;
    } else if (FAILURE_CONCLUSIONS.has(run.conclusion)) {
      failed += 1;
    } else if (!EXCLUDED_FROM_RATE.has(run.conclusion)) {
      failed += 1;
    }
  }
  const denominator = success + failed;
  return denominator === 0 ? null : success / denominator;
}

function runLabel(run: RunRecord): string {
  return `run:${run.githubId}`;
}

/** All runs for a repository, newest first (single batched read). */
async function loadRuns(repositoryId: string): Promise<RunRow[]> {
  const rows = await getDb()
    .select()
    .from(ciRuns)
    .where(eq(ciRuns.repositoryId, repositoryId))
    .orderBy(desc(ciRuns.githubCreatedAt));
  return rows;
}

async function loadWorkflows(repositoryId: string): Promise<WorkflowRow[]> {
  return getDb()
    .select()
    .from(ciWorkflows)
    .where(eq(ciWorkflows.repositoryId, repositoryId))
    .orderBy(asc(ciWorkflows.name));
}

export async function listWorkflows(repositoryId: string): Promise<WorkflowSummary[]> {
  const [workflowRows, runRows] = await Promise.all([
    loadWorkflows(repositoryId),
    loadRuns(repositoryId),
  ]);
  const runsByWorkflow = new Map<string, RunRow[]>();
  for (const run of runRows) {
    const list = runsByWorkflow.get(run.workflowId) ?? [];
    list.push(run);
    runsByWorkflow.set(run.workflowId, list);
  }
  return workflowRows.map((wf) => {
    const runs = newestFirst(runsByWorkflow.get(wf.id) ?? []);
    const completed = runs.filter(isTerminal);
    const streak = failureStreakLength(runs);
    const recentFailures = completed
      .slice(0, CI_THRESHOLDS.recentWindowRuns)
      .filter(isFailure).length;
    return {
      workflow: toWorkflowRecord(wf),
      active: wf.state === "active",
      lastRun: runs[0] ? toRunRecord(runs[0]) : null,
      recentFailures,
      failureStreak: streak,
      unstable:
        failuresInWindow(runs, CI_THRESHOLDS.unstableWindowRuns) >=
        CI_THRESHOLDS.unstableMinFailures,
    };
  });
}

export async function getWorkflow(
  repositoryId: string,
  githubWorkflowId: string,
): Promise<WorkflowSummary | null> {
  const summaries = await listWorkflows(repositoryId);
  return summaries.find((s) => s.workflow.githubId === githubWorkflowId) ?? null;
}

export async function listRuns(
  repositoryId: string,
  filters: RunListFilters = {},
): Promise<RunListPage> {
  const db = getDb();
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const perPage = Math.min(
    CI_THRESHOLDS.maxPerPage,
    Math.max(1, Math.floor(filters.perPage ?? CI_THRESHOLDS.defaultPerPage)),
  );

  const conditions = [eq(ciRuns.repositoryId, repositoryId)];
  if (filters.status) {
    conditions.push(eq(ciRuns.status, filters.status));
  }
  if (filters.conclusion) {
    conditions.push(eq(ciRuns.conclusion, filters.conclusion));
  }
  if (filters.branch) {
    conditions.push(eq(ciRuns.headBranch, filters.branch));
  }
  let workflowId: string | null = null;
  if (filters.workflow) {
    const wfRows = await db
      .select({ id: ciWorkflows.id })
      .from(ciWorkflows)
      .where(
        and(
          eq(ciWorkflows.repositoryId, repositoryId),
          eq(ciWorkflows.githubId, filters.workflow),
        ),
      )
      .limit(1);
    if (!wfRows[0]) {
      return { data: [], pagination: { page, perPage, total: 0 } };
    }
    workflowId = wfRows[0].id;
    conditions.push(eq(ciRuns.workflowId, workflowId));
  }

  const rows = await db
    .select()
    .from(ciRuns)
    .where(and(...conditions))
    .orderBy(desc(ciRuns.githubCreatedAt));
  const total = rows.length;

  // PR filter + local PR resolution in one batched pass (no N+1).
  let filtered = rows;
  let prNumbersByRun = new Map<string, number[]>();
  if (rows.length > 0) {
    const prRows = await db
      .select({ number: pullRequests.number, headSha: pullRequests.headSha })
      .from(pullRequests)
      .where(eq(pullRequests.repositoryId, repositoryId));
    const prByNumber = new Map(prRows.map((p) => [p.number, p]));
    const shasToPrs = new Map<string, number[]>();
    for (const pr of prRows) {
      if (pr.headSha) {
        const list = shasToPrs.get(pr.headSha) ?? [];
        list.push(pr.number);
        shasToPrs.set(pr.headSha, list);
      }
    }
    prNumbersByRun = new Map(
      rows.map((run) => {
        const fromGithub = (run.prNumbers ?? []).filter((n) => prByNumber.has(n));
        const fromSha = run.headSha ? (shasToPrs.get(run.headSha) ?? []) : [];
        return [run.githubId, [...new Set([...fromGithub, ...fromSha])].sort((a, b) => a - b)];
      }),
    );
    if (filters.pr !== undefined) {
      filtered = rows.filter((run) =>
        (prNumbersByRun.get(run.githubId) ?? []).includes(filters.pr as number),
      );
    }
  }

  const totalFiltered = filtered.length;
  const pageRows = filtered.slice((page - 1) * perPage, page * perPage);

  const workflowRows = await loadWorkflows(repositoryId);
  const nameById = new Map(workflowRows.map((w) => [w.id, w.name]));

  return {
    data: pageRows.map((run) => ({
      ...toRunRecord(run),
      workflowName: nameById.get(run.workflowId) ?? null,
      linkedPrs: prNumbersByRun.get(run.githubId) ?? [],
    })),
    pagination: { page, perPage, total: filters.pr !== undefined ? totalFiltered : total },
  };
}

export async function getCiSummary(repositoryId: string): Promise<CiSummary> {
  const logger = getLogger();
  const [workflowRows, runRows] = await Promise.all([
    loadWorkflows(repositoryId),
    loadRuns(repositoryId),
  ]);
  const workflowsById = new Map(workflowRows.map((w) => [w.id, toWorkflowRecord(w)]));
  const runs = newestFirst(runRows);
  const completed = runs.filter(isTerminal);
  const success = runs.filter(isSuccess).length;
  const failed = runs.filter(isFailure).length;
  const running = runs.filter((r) => !isTerminal(r)).length;
  const other = completed.length - success - failed;

  const activeWorkflows = workflowRows.filter((w) => w.state === "active").length;
  const rate = successRate(runs);

  const failureStreaks: CiSummary["failureStreaks"] = [];
  const unstableWorkflows: CiSummary["unstableWorkflows"] = [];
  const recovered: CiSummary["recovered"] = [];
  const signals: CiSignal[] = [];

  for (const wf of workflowRows) {
    const wfRuns = newestFirst(runs.filter((r) => r.workflowId === wf.id));
    if (wfRuns.length === 0) {
      continue;
    }
    const streak = failureStreakLength(wfRuns);
    if (streak >= CI_THRESHOLDS.failureStreakMin) {
      failureStreaks.push({
        workflowGithubId: wf.githubId,
        workflowName: wf.name,
        streak,
        lastRunGithubId: String(wfRuns.find(isTerminal)?.id ?? wfRuns[0].id),
      });
      signals.push({
        type: "failure_streak",
        severity: streak >= CI_THRESHOLDS.failureStreakHigh ? "high" : "medium",
        title: `${wf.name ?? wf.githubId}: ${streak} consecutive failures`,
        detail: `The newest terminal runs for this workflow all failed — an ongoing breakage, not a single bad run.`,
        evidence: [
          { label: "Workflow", value: wf.name ?? wf.githubId },
          { label: "Streak", value: String(streak) },
          { label: "Latest run", value: runLabel(toRunRecord(wfRuns.find(isTerminal) ?? wfRuns[0])) },
        ],
      });
    } else if (streak === 0) {
      // A success on top of an older failure streak = recovery context.
      const rest = wfRuns.slice(1);
      const olderStreak = failureStreakLength(rest);
      if (olderStreak >= CI_THRESHOLDS.failureStreakMin && isSuccess(wfRuns[0])) {
        recovered.push({
          workflowGithubId: wf.githubId,
          workflowName: wf.name,
          afterStreak: olderStreak,
        });
        signals.push({
          type: "recovered",
          severity: "info",
          title: `${wf.name ?? wf.githubId} recovered after ${olderStreak} failures`,
          detail: `The latest run succeeded after ${olderStreak} consecutive failures — recovery context, not a risk claim.`,
          evidence: [
            { label: "Workflow", value: wf.name ?? wf.githubId },
            { label: "Recovered after", value: String(olderStreak) },
          ],
        });
      }
    }
    const windowFailures = failuresInWindow(wfRuns, CI_THRESHOLDS.unstableWindowRuns);
    if (windowFailures >= CI_THRESHOLDS.unstableMinFailures) {
      unstableWorkflows.push({
        workflowGithubId: wf.githubId,
        workflowName: wf.name,
        failures: windowFailures,
        window: CI_THRESHOLDS.unstableWindowRuns,
      });
      signals.push({
        type: "unstable",
        severity: "medium",
        title: `${wf.name ?? wf.githubId} unstable: ${windowFailures} failures in last ${CI_THRESHOLDS.unstableWindowRuns} runs`,
        detail: `Repeated success/failure oscillation — instability worth investigating, not a single root cause.`,
        evidence: [
          { label: "Workflow", value: wf.name ?? wf.githubId },
          { label: "Failures", value: `${windowFailures}/${CI_THRESHOLDS.unstableWindowRuns}` },
        ],
      });
    }
  }

  // Recent failures (completed, newest first, capped).
  const recentWindow = runs.slice(0, CI_THRESHOLDS.recentWindowRuns);
  const recentFailed = recentWindow.filter(isFailure).slice(0, CI_THRESHOLDS.recentFailuresShown);
  const recentFailures = recentFailed.map((run) => ({
    ...toRunRecord(run),
    workflowName: workflowsById.get(run.workflowId)?.name ?? null,
  }));
  for (const run of recentFailed) {
    signals.push({
      type: "recent_failure",
      severity: "medium",
      title: `Failed: ${workflowsById.get(run.workflowId)?.name ?? "workflow"} #${run.runNumber ?? run.githubId}`,
      detail: `A recent terminal failure — inspect the run, its commit, and linked changes. Not a diagnosis.`,
      evidence: [
        { label: "Run", value: runLabel(toRunRecord(run)) },
        { label: "Workflow", value: workflowsById.get(run.workflowId)?.name ?? "?" },
        { label: "Branch", value: run.headBranch ?? "?" },
        { label: "SHA", value: run.headSha ?? "?" },
        { label: "Conclusion", value: run.conclusion ?? "?" },
      ],
    });
  }

  // Stale non-terminal runs.
  const now = Date.now();
  const staleCutoff = now - CI_THRESHOLDS.staleRunningMinutes * 60_000;
  const staleRuns = runs
    .filter((run) => {
      if (isTerminal(run)) {
        return false;
      }
      const anchor = run.githubUpdatedAt?.getTime() ?? run.githubCreatedAt?.getTime() ?? Number.NaN;
      return !Number.isNaN(anchor) && anchor < staleCutoff;
    })
    .map((run) => ({
      ...toRunRecord(run),
      workflowName: workflowsById.get(run.workflowId)?.name ?? null,
    }));
  for (const run of staleRuns.slice(0, 10)) {
    signals.push({
      type: "stale_running",
      severity: "medium",
      title: `Stuck ${run.status ?? "non-terminal"} run: ${run.workflowName ?? "workflow"} #${run.runNumber ?? run.githubId}`,
      detail: `Non-terminal beyond the staleness threshold — distinct from failure; possibly queued behind runners or wedged.`,
      evidence: [
        { label: "Run", value: `run:${run.githubId}` },
        { label: "Status", value: run.status ?? "?" },
      ],
    });
  }

  // Long-running completed runs.
  const longCutoffSec = CI_THRESHOLDS.longRunMinutes * 60;
  const longRuns = runs.filter(
    (run) => isTerminal(run) && run.durationSec !== null && run.durationSec >= longCutoffSec,
  );
  for (const run of longRuns.slice(0, 5)) {
    signals.push({
      type: "long_running",
      severity: "info",
      title: `Long run: ${workflowsById.get(run.workflowId)?.name ?? "workflow"} took ${Math.round((run.durationSec ?? 0) / 60)}m`,
      detail: `Duration signal only — long does not mean failed.`,
      evidence: [
        { label: "Run", value: `run:${run.githubId}` },
        { label: "Duration (s)", value: String(run.durationSec) },
      ],
    });
  }

  // Branch failure context.
  const failuresByBranch = new Map<string, number>();
  for (const run of recentWindow) {
    if (isFailure(run) && run.headBranch) {
      failuresByBranch.set(run.headBranch, (failuresByBranch.get(run.headBranch) ?? 0) + 1);
    }
  }
  for (const [branch, count] of [...failuresByBranch.entries()]
    .filter(([, count]) => count >= CI_THRESHOLDS.branchFailureMin)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    signals.push({
      type: "branch_failures",
      severity: "low",
      title: `${count} recent CI failures observed on branch ${branch}`,
      detail: `Branch-level context — not a claim that the branch itself is broken.`,
      evidence: [
        { label: "Branch", value: branch },
        { label: "Failures", value: String(count) },
      ],
    });
  }

  // PR ↔ CI correlation (latest run per PR via head-SHA or GitHub association).
  const db = getDb();
  const prRows = await db
    .select({
      number: pullRequests.number,
      title: pullRequests.title,
      headSha: pullRequests.headSha,
    })
    .from(pullRequests)
    .where(eq(pullRequests.repositoryId, repositoryId));
  const prCiStates: PrCiState[] = [];
  for (const pr of prRows) {
    const candidates = runs.filter(
      (run) =>
        (run.headSha !== null && run.headSha === pr.headSha) ||
        (run.prNumbers ?? []).includes(pr.number),
    );
    if (candidates.length === 0) {
      continue;
    }
    const latest = candidates[0];
    const wfName = workflowsById.get(latest.workflowId)?.name ?? null;
    const state: PrCiState["state"] = !isTerminal(latest)
      ? "running"
      : isSuccess(latest)
        ? "passing"
        : isFailure(latest)
          ? "failed"
          : "unknown";
    prCiStates.push({
      prNumber: pr.number,
      prTitle: pr.title,
      state,
      runGithubId: latest.githubId,
      workflowName: wfName,
      conclusion: latest.conclusion,
    });
    if (state === "failed") {
      signals.push({
        type: "pr_ci_failure",
        severity: "medium",
        title: `PR #${pr.number} has failing CI`,
        detail: `Associated run ${latest.conclusion ?? "?"} — inspect before merge. Association, not a bug claim.`,
        evidence: [
          { label: "PR", value: `pr:${pr.number}` },
          { label: "Run", value: `run:${latest.githubId}` },
          { label: "Conclusion", value: latest.conclusion ?? "?" },
        ],
      });
    }
  }
  prCiStates.sort((a, b) => a.prNumber - b.prNumber);

  const firstFailure = recentWindow.find(isFailure);
  logger.debug(
    { repositoryId, workflows: workflowRows.length, runs: runs.length, signals: signals.length },
    "CI summary computed",
  );

  return {
    counts: {
      workflows: workflowRows.length,
      activeWorkflows,
      runs: runs.length,
      running,
      completed: completed.length,
      success,
      failed,
      other,
      successRate: rate,
    },
    signals,
    failureStreaks: failureStreaks.sort((a, b) => b.streak - a.streak),
    unstableWorkflows,
    recentFailures,
    staleRuns,
    recovered,
    prCiStates,
    lastFailureAt: firstFailure?.completedAt ?? firstFailure?.githubUpdatedAt ?? null,
  };
}

/**
 * Full run investigation: workflow, jobs, commit, linked PRs, reachable
 * files with churn context, overlapping risks, related issues (via PR
 * links), and run-scoped signals. Correlation only — never causal claims.
 */
export async function getRunDetail(
  repositoryId: string,
  githubRunId: string,
): Promise<RunDetail | null> {
  const logger = getLogger();
  const db = getDb();

  const runRows = await db
    .select()
    .from(ciRuns)
    .where(and(eq(ciRuns.repositoryId, repositoryId), eq(ciRuns.githubId, githubRunId)))
    .limit(1);
  const runRow = runRows[0];
  if (!runRow) {
    return null;
  }
  const run = toRunRecord(runRow);

  const [workflowRows, jobRows] = await Promise.all([
    db.select().from(ciWorkflows).where(eq(ciWorkflows.id, runRow.workflowId)).limit(1),
    db
      .select()
      .from(ciJobs)
      .where(eq(ciJobs.runId, runRow.id))
      .orderBy(asc(ciJobs.name)),
  ]);
  const workflow = workflowRows[0] ? toWorkflowRecord(workflowRows[0]) : null;
  const jobs: JobRecord[] = jobRows.map((j) => ({
    githubId: j.githubId,
    name: j.name,
    status: j.status,
    conclusion: j.conclusion,
    startedAt: j.startedAt,
    completedAt: j.completedAt,
    durationSec: j.durationSec,
    htmlUrl: j.htmlUrl,
  }));

  // Commit by head SHA (when synced).
  const commitRows = run.headSha
    ? await db
      .select({
        sha: commits.sha,
        message: commits.message,
        authorLogin: commits.authorLogin,
      })
      .from(commits)
      .where(and(eq(commits.repositoryId, repositoryId), eq(commits.sha, run.headSha)))
      .limit(1)
    : [];
  const commit = commitRows[0] ?? null;

  // PRs: GitHub association (filtered to local) + head-SHA match.
  const prRows = await db
    .select({
      number: pullRequests.number,
      title: pullRequests.title,
      state: pullRequests.state,
      merged: pullRequests.merged,
      headSha: pullRequests.headSha,
    })
    .from(pullRequests)
    .where(eq(pullRequests.repositoryId, repositoryId));
  const linkedPrs = prRows
    .filter(
      (pr) =>
        run.prNumbers.includes(pr.number) ||
        (run.headSha !== null && pr.headSha !== null && pr.headSha === run.headSha),
    )
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      merged: pr.merged,
      via: run.prNumbers.includes(pr.number) ? "github-association" : "head-sha",
    }))
    .sort((a, b) => a.number - b.number);

  // Files via commit → commit_files.
  const fileRows = commit
    ? await db
      .select({ path: commitFiles.path })
      .from(commitFiles)
      .innerJoin(commits, eq(commitFiles.commitId, commits.id))
      .where(
        and(eq(commitFiles.repositoryId, repositoryId), eq(commits.sha, commit.sha)),
      )
    : [];
  const filePaths = [...new Set(fileRows.map((f) => f.path))].sort();

  // Window churn + corrective context for reachable paths.
  const windowChanges = new Map<string, number>();
  const correctivePaths = new Set<string>();
  if (filePaths.length > 0) {
    const rows = await db
      .select({ path: commitFiles.path, message: commits.message })
      .from(commitFiles)
      .innerJoin(commits, eq(commitFiles.commitId, commits.id))
      .where(
        and(
          eq(commitFiles.repositoryId, repositoryId),
          inArray(commitFiles.path, filePaths),
        ),
      );
    for (const row of rows) {
      windowChanges.set(row.path, (windowChanges.get(row.path) ?? 0) + 1);
      if (isCorrectiveMessage(row.message)) {
        correctivePaths.add(row.path);
      }
    }
  }
  const files = filePaths.map((path) => ({
    path,
    windowChanges: windowChanges.get(path) ?? 0,
    hot: (windowChanges.get(path) ?? 0) >= RISK_THRESHOLDS.hotFileMinCommits,
  }));

  const pathSet = new Set(filePaths);
  const riskReport = await analyzeRepositoryRisks(repositoryId);
  const riskFindings = riskReport.findings
    .filter((f) => f.affectedFiles.some((p) => pathSet.has(p)))
    .map((f) => ({ id: f.id, type: f.type, severity: f.severity, title: f.title }))
    .sort((a, b) => (a.severity < b.severity ? -1 : a.severity > b.severity ? 1 : a.id < b.id ? -1 : 1));

  // Issues via linked PRs (existing issue↔PR relationship records).
  let relatedIssues: RunDetail["relatedIssues"] = [];
  if (linkedPrs.length > 0) {
    const prIdRows = await db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.repositoryId, repositoryId),
          inArray(
            pullRequests.number,
            linkedPrs.map((p) => p.number),
          ),
        ),
      );
    if (prIdRows.length > 0) {
      const linkRows = await db
        .select({
          number: issues.number,
          title: issues.title,
          state: issues.state,
        })
        .from(issuePrLinks)
        .innerJoin(issues, eq(issuePrLinks.issueId, issues.id))
        .where(
          and(
            eq(issuePrLinks.repositoryId, repositoryId),
            inArray(
              issuePrLinks.pullRequestId,
              prIdRows.map((r) => r.id),
            ),
          ),
        );
      const seen = new Set<number>();
      relatedIssues = linkRows
        .filter((i) => {
          if (seen.has(i.number)) {
            return false;
          }
          seen.add(i.number);
          return true;
        })
        .sort((a, b) => a.number - b.number);
    }
  }

  // Run-scoped signals (subset of summary logic, scoped to this run).
  const signals: CiSignal[] = [];
  if (isFailure(runRow)) {
    signals.push({
      type: "run_failed",
      severity: "medium",
      title: `Run concluded ${run.conclusion}`,
      detail: commit
        ? `Failed on commit ${commit.sha.slice(0, 7)} — association with the commit and its files below, not a root cause.`
        : `Failed without a locally synced commit — SHA ${run.headSha ?? "unknown"} is not in the synced history.`,
      evidence: [
        { label: "Run", value: `run:${run.githubId}` },
        { label: "Conclusion", value: run.conclusion ?? "?" },
        ...(commit ? [{ label: "Commit", value: `commit:${commit.sha.slice(0, 12)}` }] : []),
      ],
    });
  }
  if (!isTerminal(runRow)) {
    const anchor = run.githubUpdatedAt?.getTime() ?? run.githubCreatedAt?.getTime() ?? Number.NaN;
    const stale = !Number.isNaN(anchor) && anchor < Date.now() - CI_THRESHOLDS.staleRunningMinutes * 60_000;
    signals.push({
      type: stale ? "stale_running" : "run_in_progress",
      severity: stale ? "medium" : "info",
      title: stale ? `Stuck ${run.status ?? "non-terminal"} run` : `Run ${run.status ?? "in progress"}`,
      detail: stale
        ? "Non-terminal beyond the staleness threshold — possibly queued or wedged."
        : "Currently executing — conclusion unknown until it completes.",
      evidence: [
        { label: "Run", value: `run:${run.githubId}` },
        { label: "Status", value: run.status ?? "?" },
      ],
    });
  }
  if (isSuccess(runRow)) {
    signals.push({
      type: "run_succeeded",
      severity: "info",
      title: "Run succeeded",
      detail: "Terminal success for the recorded commit and workflow.",
      evidence: [
        { label: "Run", value: `run:${run.githubId}` },
        { label: "Conclusion", value: "success" },
      ],
    });
  }
  // Sibling context: streak position of this run within its workflow.
  const siblingRows = await db
    .select()
    .from(ciRuns)
    .where(
      and(eq(ciRuns.repositoryId, repositoryId), eq(ciRuns.workflowId, runRow.workflowId)),
    )
    .orderBy(desc(ciRuns.githubCreatedAt));
  const ordered = newestFirst(siblingRows);
  const position = ordered.findIndex((r) => r.githubId === run.githubId);
  const newer = position > 0 ? ordered.slice(0, position) : [];
  const streakAfter = failureStreakLength(newer);
  if (isFailure(runRow) && streakAfter > 0) {
    signals.push({
      type: "failure_streak",
      severity: streakAfter + 1 >= CI_THRESHOLDS.failureStreakHigh ? "high" : "medium",
      title: `Part of a ${streakAfter + 1}-run failure streak`,
      detail: "Consecutive terminal failures around this run — ongoing breakage context.",
      evidence: [{ label: "Streak", value: String(streakAfter + 1) }],
    });
  }
  if (riskFindings.length > 0) {
    signals.push({
      type: "risk_overlap",
      severity: "medium",
      title: `${riskFindings.length} existing risk finding${riskFindings.length === 1 ? "" : "s"} overlap${riskFindings.length === 1 ? "s" : ""} this run's files`,
      detail: "Files changed in the run's commit are already flagged by the Risk Engine — context, not cause.",
      evidence: riskFindings.slice(0, 10).map((f) => ({
        label: `${f.severity}: ${f.title}`,
        value: f.id,
      })),
    });
  }

  logger.debug(
    { repositoryId, runGithubId: run.githubId, signals: signals.length },
    "CI run detail computed",
  );

  return {
    run,
    workflow,
    jobs,
    commit,
    linkedPrs,
    files,
    riskFindings,
    relatedIssues,
    signals,
  };
}
