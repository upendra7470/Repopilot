import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/index.js";
import {
  commits,
  commitFiles,
  prCommits,
  prFiles,
  pullRequests,
} from "../db/schema.js";
import { areaOfPath } from "./memory.service.js";
import {
  analyzeRepositoryRisks,
  isCorrectiveMessage,
  RISK_THRESHOLDS,
} from "./risk.service.js";
import { getLogger } from "../utils/logger.js";

/**
 * Deterministic PR intelligence (Phase 8, no LLM).
 *
 * Every signal is computed from persisted records with explicit thresholds.
 * Neutral language throughout: a large diff is a "large change surface",
 * never "bad". Cross-references repository memory and Risk Engine findings
 * for the same paths.
 */

export interface PrSignalEvidence {
  label: string;
  value: string;
}

export interface PrSignal {
  type: string;
  severity: "info" | "low" | "medium" | "high";
  title: string;
  detail: string;
  evidence: PrSignalEvidence[];
}

export interface PrFileEvidence {
  path: string;
  status: string | null;
  additions: number | null;
  deletions: number | null;
  windowChanges: number;
  hot: boolean;
}

export interface PrCommitEvidence {
  sha: string;
  message: string | null;
  authorLogin: string | null;
  committedAt: Date | null;
}

export interface PrAreaStat {
  area: string;
  changes: number;
}

export interface PrRiskContext {
  id: string;
  type: string;
  severity: string;
  title: string;
}

export interface PrIntelligence {
  signals: PrSignal[];
  stats: {
    additions: number | null;
    deletions: number | null;
    changedFiles: number | null;
    commits: number;
    contributors: string[];
  };
  areas: PrAreaStat[];
  files: PrFileEvidence[];
  commits: PrCommitEvidence[];
  riskFindings: PrRiskContext[];
}

export interface PrRecord {
  id: string;
  repositoryId: string;
  githubId: string;
  number: number;
  title: string | null;
  body: string | null;
  state: string;
  draft: boolean;
  merged: boolean;
  authorLogin: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  headSha: string | null;
  baseSha: string | null;
  mergeCommitSha: string | null;
  htmlUrl: string | null;
  additions: number | null;
  deletions: number | null;
  changedFilesCount: number | null;
  githubCreatedAt: Date | null;
  githubUpdatedAt: Date | null;
  closedAt: Date | null;
  mergedAt: Date | null;
}

/** PRs for a repository, newest updated first, optional state filter. */
export async function listPullRequests(
  repositoryId: string,
  state?: string,
): Promise<PrRecord[]> {
  const db = getDb();
  const conditions = [eq(pullRequests.repositoryId, repositoryId)];
  if (state === "open" || state === "closed") {
    conditions.push(eq(pullRequests.state, state));
  } else if (state === "merged") {
    conditions.push(eq(pullRequests.merged, true));
  }
  const rows = await db
    .select()
    .from(pullRequests)
    .where(and(...conditions))
    .orderBy(desc(pullRequests.githubUpdatedAt));
  return rows.map(toPrRecord);
}

export async function getPullRequest(
  repositoryId: string,
  number: number,
): Promise<PrRecord | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.repositoryId, repositoryId),
        eq(pullRequests.number, number),
      ),
    )
    .limit(1);
  return rows[0] ? toPrRecord(rows[0]) : null;
}

function toPrRecord(row: typeof pullRequests.$inferSelect): PrRecord {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    githubId: row.githubId,
    number: row.number,
    title: row.title,
    body: row.body,
    state: row.state,
    draft: row.draft,
    merged: row.merged,
    authorLogin: row.authorLogin,
    sourceBranch: row.sourceBranch,
    targetBranch: row.targetBranch,
    headSha: row.headSha,
    baseSha: row.baseSha,
    mergeCommitSha: row.mergeCommitSha,
    htmlUrl: row.htmlUrl,
    additions: row.additions,
    deletions: row.deletions,
    changedFilesCount: row.changedFilesCount,
    githubCreatedAt: row.githubCreatedAt,
    githubUpdatedAt: row.githubUpdatedAt,
    closedAt: row.closedAt,
    mergedAt: row.mergedAt,
  };
}

const LARGE_PR_LINES = 1000;
const MODERATE_PR_LINES = 100;
const BROAD_FILE_SPREAD = 20;
const OPEN_AGE_DAYS = 30;

/**
 * Compute deterministic intelligence for one PR. Pure function of persisted
 * records — same database state always yields the same result.
 */
export async function computePrIntelligence(
  repositoryId: string,
  prNumber: number,
): Promise<PrIntelligence | null> {
  const logger = getLogger();
  const db = getDb();

  const pr = await getPullRequest(repositoryId, prNumber);
  if (!pr) {
    return null;
  }

  const fileRows = await db
    .select()
    .from(prFiles)
    .where(eq(prFiles.pullRequestId, pr.id));
  const commitRows = await db
    .select({
      sha: commits.sha,
      message: commits.message,
      authorLogin: commits.authorLogin,
      committedAt: commits.committedAt,
    })
    .from(prCommits)
    .innerJoin(commits, eq(prCommits.commitId, commits.id))
    .where(eq(prCommits.pullRequestId, pr.id))
    .orderBy(desc(commits.committedAt));

  const paths = fileRows.map((f) => f.path);
  const totalLines = (pr.additions ?? 0) + (pr.deletions ?? 0);

  // Window change counts for exactly the touched paths (one grouped query).
  const windowChanges = new Map<string, number>();
  const windowAuthors = new Map<string, Set<string>>();
  if (paths.length > 0) {
    const rows = await db
      .select({ path: commitFiles.path, authorLogin: commits.authorLogin })
      .from(commitFiles)
      .innerJoin(commits, eq(commitFiles.commitId, commits.id))
      .where(
        and(
          eq(commitFiles.repositoryId, repositoryId),
          inArray(commitFiles.path, paths),
        ),
      );
    for (const row of rows) {
      windowChanges.set(row.path, (windowChanges.get(row.path) ?? 0) + 1);
      if (!windowAuthors.has(row.path)) {
        windowAuthors.set(row.path, new Set());
      }
      if (row.authorLogin) {
        windowAuthors.get(row.path)!.add(row.authorLogin);
      }
    }
  }

  // Corrective commits touching the same paths (window-wide, via messages).
  const correctivePaths = new Set<string>();
  if (paths.length > 0) {
    const rows = await db
      .select({ path: commitFiles.path, message: commits.message })
      .from(commitFiles)
      .innerJoin(commits, eq(commitFiles.commitId, commits.id))
      .where(
        and(
          eq(commitFiles.repositoryId, repositoryId),
          inArray(commitFiles.path, paths),
        ),
      );
    for (const row of rows) {
      if (isCorrectiveMessage(row.message)) {
        correctivePaths.add(row.path);
      }
    }
  }

  // Overlapping Risk Engine findings (same run, filtered to PR paths).
  const riskReport = await analyzeRepositoryRisks(repositoryId);
  const pathSet = new Set(paths);
  const riskFindings = riskReport.findings
    .filter((f) => f.affectedFiles.some((p) => pathSet.has(p)))
    .map((f) => ({ id: f.id, type: f.type, severity: f.severity, title: f.title }));

  const signals: PrSignal[] = [];

  if (totalLines >= LARGE_PR_LINES) {
    signals.push({
      type: "large_change_surface",
      severity: "medium",
      title: "Large change surface",
      detail: `This PR adds and removes about ${totalLines.toLocaleString()} lines — a large surface to review carefully.`,
      evidence: [
        { label: "Additions", value: String(pr.additions ?? 0) },
        { label: "Deletions", value: String(pr.deletions ?? 0) },
      ],
    });
  } else if (totalLines >= MODERATE_PR_LINES) {
    signals.push({
      type: "moderate_change_surface",
      severity: "info",
      title: "Moderate change surface",
      detail: `About ${totalLines.toLocaleString()} lines changed — a moderate review load.`,
      evidence: [
        { label: "Additions", value: String(pr.additions ?? 0) },
        { label: "Deletions", value: String(pr.deletions ?? 0) },
      ],
    });
  }

  if (fileRows.length > BROAD_FILE_SPREAD) {
    signals.push({
      type: "broad_file_spread",
      severity: "medium",
      title: "Broad file spread",
      detail: `${fileRows.length} files changed across the repository — check whether the change set could be split.`,
      evidence: [{ label: "Changed files", value: String(fileRows.length) }],
    });
  }

  const hotTouched = fileRows.filter(
    (f) => (windowChanges.get(f.path) ?? 0) >= RISK_THRESHOLDS.hotFileMinCommits,
  );
  if (hotTouched.length > 0) {
    signals.push({
      type: "hot_files_touched",
      severity: "medium",
      title: `Touches ${hotTouched.length} historically hot file${hotTouched.length === 1 ? "" : "s"}`,
      detail: "These files show elevated recent change activity in this repository.",
      evidence: hotTouched.slice(0, 10).map((f) => ({
        label: f.path,
        value: `${windowChanges.get(f.path) ?? 0} recent changes`,
      })),
    });
  }

  if (correctivePaths.size > 0) {
    const listed = [...correctivePaths].slice(0, 10);
    signals.push({
      type: "corrective_context",
      severity: "low",
      title: "Recent corrective activity in touched areas",
      detail:
        "Corrective-looking commits recently touched the same files — worth checking whether this PR relates to that work.",
      evidence: listed.map((path) => ({ label: path, value: "corrective history" })),
    });
  }

  if (riskFindings.length > 0) {
    signals.push({
      type: "risk_overlap",
      severity: "medium",
      title: `${riskFindings.length} existing risk finding${riskFindings.length === 1 ? "" : "s"} touch${riskFindings.length === 1 ? "es" : ""} these paths`,
      detail: "The repository Risk Engine already flags these areas from synced history.",
      evidence: riskFindings.slice(0, 10).map((f) => ({
        label: `${f.severity}: ${f.title}`,
        value: f.id,
      })),
    });
  }

  const contributors = [...new Set(commitRows.map((c) => c.authorLogin).filter((l): l is string => !!l))];
  if (pr.authorLogin && contributors.length > 0 && !contributors.includes(pr.authorLogin)) {
    signals.push({
      type: "author_not_in_history",
      severity: "info",
      title: "Author absent from recent file history",
      detail: `${pr.authorLogin} does not appear among recent authors of the touched files — useful context, not a judgment.`,
      evidence: [{ label: "PR author", value: pr.authorLogin }],
    });
  }

  if (pr.githubCreatedAt) {
    const ageDays = Math.floor((Date.now() - pr.githubCreatedAt.getTime()) / 86_400_000);
    if (!pr.merged && pr.state === "open" && ageDays > OPEN_AGE_DAYS) {
      signals.push({
        type: "stale_open_pr",
        severity: "low",
        title: `Open for ${ageDays} days`,
        detail: "Long-open PRs can drift from the base branch; confirm it still merges cleanly.",
        evidence: [{ label: "Age (days)", value: String(ageDays) }],
      });
    }
  }
  if (pr.draft) {
    signals.push({
      type: "draft_state",
      severity: "info",
      title: "Draft pull request",
      detail: "Marked as draft — likely still in progress.",
      evidence: [],
    });
  }

  const areaCounts = new Map<string, number>();
  for (const f of fileRows) {
    const area = areaOfPath(f.path);
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
  }

  logger.debug(
    { repositoryId, prNumber, signals: signals.length },
    "PR intelligence computed",
  );

  return {
    signals,
    stats: {
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changedFilesCount ?? fileRows.length,
      commits: commitRows.length,
      contributors,
    },
    areas: [...areaCounts.entries()]
      .map(([area, changes]) => ({ area, changes }))
      .sort((a, b) => b.changes - a.changes || (a.area < b.area ? -1 : 1)),
    files: fileRows.map((f) => ({
      path: f.path,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      windowChanges: windowChanges.get(f.path) ?? 0,
      hot:
        (windowChanges.get(f.path) ?? 0) >= RISK_THRESHOLDS.hotFileMinCommits,
    })),
    commits: commitRows.map((c) => ({
      sha: c.sha,
      message: c.message,
      authorLogin: c.authorLogin,
      committedAt: c.committedAt,
    })),
    riskFindings,
  };
}
