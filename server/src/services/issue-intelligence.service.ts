import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import {
  commits,
  commitFiles,
  issueCommitLinks,
  issueComments,
  issuePrLinks,
  issues,
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
 * Deterministic issue intelligence (Phase 9, no LLM).
 *
 * Every signal is computed from persisted records with explicit thresholds
 * below. Neutral language throughout: an old issue is "stale", never
 * "bad". Cross-references PR/commit/file history and Risk Engine findings
 * through explicit relationship records — never title similarity.
 *
 * NOTE on reopened/recurring detection (spec signal H): the persisted model
 * carries no state history (only current state + timestamps), so reopen
 * behavior cannot be observed. The signal is OMITTED rather than
 * fabricated; see ISSUE_THRESHOLDS / tests.
 */

export const ISSUE_THRESHOLDS = {
  /** Open issues older than this are stale (neutral aging label). */
  staleOpenDays: 30,
  /** Open issues without updates for this long are inactive. */
  inactiveDays: 21,
  /** Updated within this window counts as recently active. */
  recentlyActiveDays: 7,
  /** Comment window counted as "recent" activity. */
  recentCommentDays: 7,
  /** Absolute comment volume that always counts as high discussion. */
  highDiscussionMinComments: 10,
  /** Relative bar: comments above this multiple of the repo mean. */
  highDiscussionMeanMultiple: 3,
  /** Floor for the relative bar (avoids flagging 2-comment issues). */
  highDiscussionMinForRelative: 5,
  /** Default list page size / hard cap. */
  defaultPerPage: 20,
  maxPerPage: 50,
} as const;

export interface IssueSignalEvidence {
  label: string;
  value: string;
}

export interface IssueSignal {
  type: string;
  severity: "info" | "low" | "medium" | "high";
  title: string;
  detail: string;
  evidence: IssueSignalEvidence[];
}

export interface IssueDimensions {
  ageDays: number | null;
  daysSinceUpdate: number | null;
  commentCount: number;
  recentCommentCount: number;
  linkedPrCount: number;
  linkedCommitCount: number;
  codeConnected: boolean;
  riskOverlapCount: number;
  state: string;
}

export interface IssueRecord {
  id: string;
  repositoryId: string;
  githubId: string;
  number: number;
  title: string | null;
  body: string | null;
  state: string;
  stateReason: string | null;
  authorLogin: string | null;
  authorGithubId: string | null;
  authorAssociation: string | null;
  htmlUrl: string | null;
  locked: boolean;
  commentsCount: number;
  labels: string[];
  milestoneNumber: number | null;
  milestoneTitle: string | null;
  milestoneState: string | null;
  assignees: string[];
  githubCreatedAt: Date | null;
  githubUpdatedAt: Date | null;
  closedAt: Date | null;
}

export interface LinkedPr {
  number: number;
  title: string | null;
  state: string;
  merged: boolean;
  relation: string;
  evidence: string | null;
}

export interface LinkedCommit {
  sha: string;
  message: string | null;
  authorLogin: string | null;
  committedAt: Date | null;
}

export interface IssueFileEvidence {
  path: string;
  area: string;
  viaCommits: string[];
  windowChanges: number;
  hot: boolean;
}

export interface IssueCommentEvidence {
  githubId: string;
  authorLogin: string | null;
  body: string | null;
  githubCreatedAt: Date | null;
}

export interface IssueRiskContext {
  id: string;
  type: string;
  severity: string;
  title: string;
}

export interface IssueIntelligence {
  signals: IssueSignal[];
  dimensions: IssueDimensions;
  linkedPrs: LinkedPr[];
  linkedCommits: LinkedCommit[];
  files: IssueFileEvidence[];
  riskFindings: IssueRiskContext[];
  recentComments: IssueCommentEvidence[];
}

export interface IssueListFilters {
  state?: string;
  label?: string;
  author?: string;
  signal?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}

export interface IssueListPage {
  data: Array<IssueRecord & { signals: IssueSignal[]; dimensions: IssueDimensions }>;
  pagination: { page: number; perPage: number; total: number };
}

type IssueRow = typeof issues.$inferSelect;

function toIssueRecord(row: IssueRow): IssueRecord {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    githubId: row.githubId,
    number: row.number,
    title: row.title,
    body: row.body,
    state: row.state,
    stateReason: row.stateReason,
    authorLogin: row.authorLogin,
    authorGithubId: row.authorGithubId,
    authorAssociation: row.authorAssociation,
    htmlUrl: row.htmlUrl,
    locked: row.locked,
    commentsCount: row.commentsCount,
    labels: row.labels ?? [],
    milestoneNumber: row.milestoneNumber,
    milestoneTitle: row.milestoneTitle,
    milestoneState: row.milestoneState,
    assignees: row.assignees ?? [],
    githubCreatedAt: row.githubCreatedAt,
    githubUpdatedAt: row.githubUpdatedAt,
    closedAt: row.closedAt,
  };
}

const DAY_MS = 86_400_000;

function daysSince(date: Date | null, now: number): number | null {
  if (!date) {
    return null;
  }
  const ms = date.getTime();
  if (Number.isNaN(ms)) {
    return null;
  }
  return Math.max(0, Math.floor((now - ms) / DAY_MS));
}

interface SignalInput {
  issue: IssueRecord;
  ageDays: number | null;
  daysSinceUpdate: number | null;
  recentCommentCount: number;
  linkedPrs: LinkedPr[];
  linkedCommits: Array<{ sha: string; corrective: boolean }>;
  correctivePaths: Set<string>;
  riskFindings: IssueRiskContext[];
  repoMeanComments: number;
}

/**
 * Pure signal derivation — same inputs always yield the same signals in
 * the same order. Shared by list annotation (batched) and detail
 * computation (single issue) so badges never diverge from the detail view.
 */
export function deriveIssueSignals(input: SignalInput): IssueSignal[] {
  const {
    issue,
    ageDays,
    daysSinceUpdate,
    recentCommentCount,
    linkedPrs,
    linkedCommits,
    correctivePaths,
    riskFindings,
    repoMeanComments,
  } = input;
  const signals: IssueSignal[] = [];
  const isOpen = issue.state === "open";

  if (isOpen && ageDays !== null && ageDays >= ISSUE_THRESHOLDS.staleOpenDays) {
    signals.push({
      type: "stale_open",
      severity: "low",
      title: `Open for ${ageDays} days`,
      detail:
        "Open longer than the stale threshold — check whether it still describes current work.",
      evidence: [
        { label: "Age (days)", value: String(ageDays) },
        { label: "State", value: issue.state },
        { label: "Issue", value: `issue:${issue.number}` },
      ],
    });
  }

  if (
    isOpen &&
    daysSinceUpdate !== null &&
    daysSinceUpdate >= ISSUE_THRESHOLDS.inactiveDays
  ) {
    signals.push({
      type: "inactive",
      severity: "low",
      title: `Inactive for ${daysSinceUpdate} days`,
      detail:
        "No updates or retained comments in the inactivity window — old but quiet, distinct from old but active.",
      evidence: [
        { label: "Days since update", value: String(daysSinceUpdate) },
        { label: "Recent comments", value: String(recentCommentCount) },
        { label: "Issue", value: `issue:${issue.number}` },
      ],
    });
  }

  const relativeBar = Math.max(
    ISSUE_THRESHOLDS.highDiscussionMinForRelative,
    repoMeanComments * ISSUE_THRESHOLDS.highDiscussionMeanMultiple,
  );
  if (
    issue.commentsCount >= ISSUE_THRESHOLDS.highDiscussionMinComments ||
    (issue.commentsCount >= relativeBar && repoMeanComments > 0)
  ) {
    signals.push({
      type: "high_discussion",
      severity: "medium",
      title: `${issue.commentsCount} comments`,
      detail:
        "Unusually high discussion volume for this repository — often worth triaging for scope or contention.",
      evidence: [
        { label: "Comments", value: String(issue.commentsCount) },
        { label: "Repo mean", value: repoMeanComments.toFixed(1) },
        { label: "Issue", value: `issue:${issue.number}` },
      ],
    });
  }

  if (
    daysSinceUpdate !== null &&
    daysSinceUpdate <= ISSUE_THRESHOLDS.recentlyActiveDays
  ) {
    signals.push({
      type: "recently_active",
      severity: "info",
      title: "Recently active",
      detail:
        "Updated within the recent-activity window — receiving engineering attention right now.",
      evidence: [
        { label: "Days since update", value: String(daysSinceUpdate) },
        { label: "Recent comments", value: String(recentCommentCount) },
      ],
    });
  }

  if (linkedPrs.length > 0 || linkedCommits.length > 0) {
    signals.push({
      type: "code_connected",
      severity: "info",
      title: `Connected to ${linkedPrs.length} PR${linkedPrs.length === 1 ? "" : "s"} and ${linkedCommits.length} commit${linkedCommits.length === 1 ? "" : "s"}`,
      detail:
        "Explicit references tie this issue to actual code changes — a discussion-with-evidence, not discussion-only.",
      evidence: [
        ...linkedPrs.slice(0, 5).map((pr) => ({
          label: `PR #${pr.number} (${pr.relation})`,
          value: `pr:${pr.number}`,
        })),
        ...linkedCommits.slice(0, 5).map((c) => ({
          label: `Commit ${c.sha.slice(0, 7)}`,
          value: `commit:${c.sha.slice(0, 12)}`,
        })),
      ],
    });
  } else {
    // No linked code: absence is reported by the UI as NO CODE CONNECTION
    // (no signal pushed — lack of evidence is not itself a signal).
  }

  if (riskFindings.length > 0) {
    signals.push({
      type: "risk_overlap",
      severity: "medium",
      title: `${riskFindings.length} existing risk finding${riskFindings.length === 1 ? "" : "s"} overlap${riskFindings.length === 1 ? "s" : ""} this issue's code`,
      detail:
        "Files reachable from this issue are already flagged by the repository Risk Engine.",
      evidence: riskFindings.slice(0, 10).map((f) => ({
        label: `${f.severity}: ${f.title}`,
        value: f.id,
      })),
    });
  }

  if (correctivePaths.size > 0) {
    signals.push({
      type: "corrective_context",
      severity: "low",
      title: "Recent corrective activity in connected areas",
      detail:
        "Corrective-looking commits touch files reachable from this issue — context for whether the area is already being repaired.",
      evidence: [...correctivePaths].slice(0, 10).map((path) => ({
        label: path,
        value: "corrective history",
      })),
    });
  }

  return signals;
}

/** Issues for a repository with filters, deterministic sort, pagination. */
export async function listIssues(
  repositoryId: string,
  filters: IssueListFilters = {},
): Promise<IssueListPage> {
  const db = getDb();
  const logger = getLogger();

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const perPage = Math.min(
    ISSUE_THRESHOLDS.maxPerPage,
    Math.max(1, Math.floor(filters.perPage ?? ISSUE_THRESHOLDS.defaultPerPage)),
  );

  const conditions = [eq(issues.repositoryId, repositoryId)];
  const state = filters.state ?? "open";
  if (state === "open" || state === "closed") {
    conditions.push(eq(issues.state, state));
  }

  const sort = filters.sort ?? "updated";
  const orderBy =
    sort === "created"
      ? [desc(issues.githubCreatedAt), asc(issues.number)]
      : sort === "comments"
        ? [desc(issues.commentsCount), desc(issues.githubUpdatedAt)]
        : sort === "age"
          ? [asc(issues.githubCreatedAt), asc(issues.number)]
          : [desc(issues.githubUpdatedAt), desc(issues.number)];

  let rows = await db
    .select()
    .from(issues)
    .where(and(...conditions))
    .orderBy(...orderBy);
  const totalBeforeLabel = rows.length;

  // Label/author filters apply in memory over JSON arrays (bounded page
  // sizes make this cheaper than JSON operators, and behavior is explicit).
  if (filters.label) {
    const needle = filters.label.toLowerCase();
    rows = rows.filter((r) => (r.labels ?? []).some((l) => l.toLowerCase() === needle));
  }
  if (filters.author) {
    const needle = filters.author.toLowerCase();
    rows = rows.filter((r) => (r.authorLogin ?? "").toLowerCase() === needle);
  }

  // Repo-wide mean comment volume (single aggregate) for the discussion bar.
  const [{ mean }] = await db
    .select({ mean: sql<number | null>`avg(${issues.commentsCount})` })
    .from(issues)
    .where(eq(issues.repositoryId, repositoryId));
  const repoMeanComments = typeof mean === "number" ? mean : 0;

  // One risk report per list call (not per issue).
  const riskReport = await analyzeRepositoryRisks(repositoryId);

  const total = rows.length;
  const pageRows = rows.slice((page - 1) * perPage, page * perPage);
  const pageIds = pageRows.map((r) => r.id);

  // Batched relationship reads for the page (no N+1).
  const [prLinkRows, commitLinkRows, commentRows, fileRows] = await (async () => {
    if (pageIds.length === 0) {
      return [[], [], [], []] as const;
    }
    const [prLinks, commitLinks, commentsRows, files] = await Promise.all([
      db
        .select({
          issueId: issuePrLinks.issueId,
          relation: issuePrLinks.relation,
          evidence: issuePrLinks.evidence,
          prNumber: pullRequests.number,
          prTitle: pullRequests.title,
          prState: pullRequests.state,
          prMerged: pullRequests.merged,
        })
        .from(issuePrLinks)
        .innerJoin(pullRequests, eq(issuePrLinks.pullRequestId, pullRequests.id))
        .where(inArray(issuePrLinks.issueId, pageIds)),
      db
        .select({
          issueId: issueCommitLinks.issueId,
          sha: commits.sha,
          message: commits.message,
        })
        .from(issueCommitLinks)
        .innerJoin(commits, eq(issueCommitLinks.commitId, commits.id))
        .where(inArray(issueCommitLinks.issueId, pageIds)),
      db
        .select({ issueId: issueComments.issueId, updatedAt: issueComments.githubUpdatedAt })
        .from(issueComments)
        .where(inArray(issueComments.issueId, pageIds)),
      db
        .select({ issueId: issueCommitLinks.issueId, path: commitFiles.path })
        .from(issueCommitLinks)
        .innerJoin(commitFiles, eq(issueCommitLinks.commitId, commitFiles.commitId))
        .where(inArray(issueCommitLinks.issueId, pageIds)),
    ]);
    return [prLinks, commitLinks, commentsRows, files] as const;
  })();

  const now = Date.now();
  const recentCutoff = now - ISSUE_THRESHOLDS.recentCommentDays * DAY_MS;

  const data = pageRows.map((row) => {
    const record = toIssueRecord(row);
    const linkedPrs: LinkedPr[] = prLinkRows
      .filter((l) => l.issueId === row.id)
      .map((l) => ({
        number: l.prNumber,
        title: l.prTitle,
        state: l.prState,
        merged: l.prMerged,
        relation: l.relation,
        evidence: l.evidence,
      }))
      .sort((a, b) => a.number - b.number);
    const linkedCommits = commitLinkRows
      .filter((l) => l.issueId === row.id)
      .map((l) => ({ sha: l.sha, corrective: isCorrectiveMessage(l.message) }));
    const recentCommentCount = commentRows.filter(
      (c) =>
        c.issueId === row.id &&
        c.updatedAt &&
        !Number.isNaN(c.updatedAt.getTime()) &&
        c.updatedAt.getTime() >= recentCutoff,
    ).length;
    const filePaths = [...new Set(fileRows.filter((f) => f.issueId === row.id).map((f) => f.path))].sort();
    const pathSet = new Set(filePaths);
    const riskFindings = riskReport.findings
      .filter((f) => f.affectedFiles.some((p) => pathSet.has(p)))
      .map((f) => ({ id: f.id, type: f.type, severity: f.severity, title: f.title }))
      .sort((a, b) => (a.severity < b.severity ? -1 : a.severity > b.severity ? 1 : a.id < b.id ? -1 : 1));

    // Corrective context for the page: any linked commit message reads
    // as corrective work touching these paths.
    const correctivePaths = new Set<string>(
      linkedCommits.some((c) => c.corrective)
        ? filePaths.slice(0, 10)
        : [],
    );

    const ageDays = daysSince(row.githubCreatedAt, now);
    const daysSinceUpdate = daysSince(row.githubUpdatedAt, now);
    const signals = deriveIssueSignals({
      issue: record,
      ageDays,
      daysSinceUpdate,
      recentCommentCount,
      linkedPrs,
      linkedCommits,
      correctivePaths,
      riskFindings,
      repoMeanComments,
    });

    if (filters.signal && !signals.some((s) => s.type === filters.signal)) {
      return null;
    }

    const dimensions: IssueDimensions = {
      ageDays,
      daysSinceUpdate,
      commentCount: row.commentsCount,
      recentCommentCount,
      linkedPrCount: linkedPrs.length,
      linkedCommitCount: linkedCommits.length,
      codeConnected: linkedPrs.length > 0 || linkedCommits.length > 0,
      riskOverlapCount: riskFindings.length,
      state: row.state,
    };
    return { ...record, signals, dimensions };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  logger.debug(
    { repositoryId, total: totalBeforeLabel, returned: data.length },
    "Issues listed",
  );
  return { data, pagination: { page, perPage, total } };
}

export async function getIssue(
  repositoryId: string,
  number: number,
): Promise<IssueRecord | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(issues)
    .where(and(eq(issues.repositoryId, repositoryId), eq(issues.number, number)))
    .limit(1);
  return rows[0] ? toIssueRecord(rows[0]) : null;
}

/**
 * Full deterministic intelligence for one issue: linked PRs/commits with
 * metadata, derived files with window-churn context, overlapping risk
 * findings, and recent comments. Pure function of persisted records.
 */
export async function computeIssueIntelligence(
  repositoryId: string,
  issueNumber: number,
): Promise<IssueIntelligence | null> {
  const logger = getLogger();
  const db = getDb();

  const issueRows = await db
    .select()
    .from(issues)
    .where(
      and(eq(issues.repositoryId, repositoryId), eq(issues.number, issueNumber)),
    )
    .limit(1);
  const issueRow = issueRows[0];
  if (!issueRow) {
    return null;
  }
  const issue = toIssueRecord(issueRow);
  const now = Date.now();

  const [prLinkRows, commitLinkRows, commentRows] = await Promise.all([
    db
      .select({
        relation: issuePrLinks.relation,
        evidence: issuePrLinks.evidence,
        prNumber: pullRequests.number,
        prTitle: pullRequests.title,
        prState: pullRequests.state,
        prMerged: pullRequests.merged,
      })
      .from(issuePrLinks)
      .innerJoin(pullRequests, eq(issuePrLinks.pullRequestId, pullRequests.id))
      .where(eq(issuePrLinks.issueId, issueRow.id)),
    db
      .select({
        sha: commits.sha,
        message: commits.message,
        authorLogin: commits.authorLogin,
        committedAt: commits.committedAt,
      })
      .from(issueCommitLinks)
      .innerJoin(commits, eq(issueCommitLinks.commitId, commits.id))
      .where(eq(issueCommitLinks.issueId, issueRow.id))
      .orderBy(desc(commits.committedAt)),
    db
      .select()
      .from(issueComments)
      .where(eq(issueComments.issueId, issueRow.id))
      .orderBy(desc(issueComments.githubCreatedAt)),
  ]);

  const linkedPrs: LinkedPr[] = prLinkRows
    .map((l) => ({
      number: l.prNumber,
      title: l.prTitle,
      state: l.prState,
      merged: l.prMerged,
      relation: l.relation,
      evidence: l.evidence,
    }))
    .sort((a, b) => a.number - b.number);

  const linkedCommits: LinkedCommit[] = commitLinkRows.map((c) => ({
    sha: c.sha,
    message: c.message,
    authorLogin: c.authorLogin,
    committedAt: c.committedAt,
  }));

  // Files reachable via Issue → commit → commit_files (one grouped query).
  const commitShas = linkedCommits.map((c) => c.sha);
  const pathToCommits = new Map<string, string[]>();
  if (commitShas.length > 0) {
    const fileRows = await db
      .select({ path: commitFiles.path, sha: commits.sha })
      .from(commitFiles)
      .innerJoin(commits, eq(commitFiles.commitId, commits.id))
      .where(
        and(
          eq(commitFiles.repositoryId, repositoryId),
          inArray(commits.sha, commitShas),
        ),
      );
    for (const row of fileRows) {
      const list = pathToCommits.get(row.path) ?? [];
      if (!list.includes(row.sha)) {
        list.push(row.sha);
      }
      pathToCommits.set(row.path, list);
    }
  }
  const filePaths = [...pathToCommits.keys()].sort();

  // Window churn for exactly the reachable paths (one grouped query).
  const windowChanges = new Map<string, number>();
  if (filePaths.length > 0) {
    const rows = await db
      .select({ path: commitFiles.path })
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
    }
  }

  // Corrective commits among the reachable paths.
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
      if (isCorrectiveMessage(row.message)) {
        correctivePaths.add(row.path);
      }
    }
  }

  const pathSet = new Set(filePaths);
  const riskReport = await analyzeRepositoryRisks(repositoryId);
  const riskFindings = riskReport.findings
    .filter((f) => f.affectedFiles.some((p) => pathSet.has(p)))
    .map((f) => ({ id: f.id, type: f.type, severity: f.severity, title: f.title }))
    .sort((a, b) => (a.severity < b.severity ? -1 : a.severity > b.severity ? 1 : a.id < b.id ? -1 : 1));

  const hotPaths = new Set(
    filePaths.filter(
      (p) => (windowChanges.get(p) ?? 0) >= RISK_THRESHOLDS.hotFileMinCommits,
    ),
  );

  const [{ mean }] = await db
    .select({ mean: sql<number | null>`avg(${issues.commentsCount})` })
    .from(issues)
    .where(eq(issues.repositoryId, repositoryId));
  const repoMeanComments = typeof mean === "number" ? mean : 0;

  const recentCutoff = now - ISSUE_THRESHOLDS.recentCommentDays * DAY_MS;
  const recentCommentCount = commentRows.filter(
    (c) =>
      c.githubUpdatedAt &&
      !Number.isNaN(c.githubUpdatedAt.getTime()) &&
      c.githubUpdatedAt.getTime() >= recentCutoff,
  ).length;

  const ageDays = daysSince(issueRow.githubCreatedAt, now);
  const daysSinceUpdate = daysSince(issueRow.githubUpdatedAt, now);

  const signals = deriveIssueSignals({
    issue,
    ageDays,
    daysSinceUpdate,
    recentCommentCount,
    linkedPrs,
    linkedCommits: linkedCommits.map((c) => ({
      sha: c.sha,
      corrective: isCorrectiveMessage(c.message),
    })),
    correctivePaths,
    riskFindings,
    repoMeanComments,
  });

  const files: IssueFileEvidence[] = filePaths.map((path) => ({
    path,
    area: areaOfPath(path),
    viaCommits: (pathToCommits.get(path) ?? []).map((sha) => sha.slice(0, 12)),
    windowChanges: windowChanges.get(path) ?? 0,
    hot: hotPaths.has(path),
  }));

  const recentComments: IssueCommentEvidence[] = commentRows.slice(0, 20).map((c) => ({
    githubId: c.githubId,
    authorLogin: c.authorLogin,
    body: c.body,
    githubCreatedAt: c.githubCreatedAt,
  }));

  logger.debug(
    { repositoryId, issueNumber, signals: signals.length, files: files.length },
    "Issue intelligence computed",
  );

  return {
    signals,
    dimensions: {
      ageDays,
      daysSinceUpdate,
      commentCount: issueRow.commentsCount,
      recentCommentCount,
      linkedPrCount: linkedPrs.length,
      linkedCommitCount: linkedCommits.length,
      codeConnected: linkedPrs.length > 0 || linkedCommits.length > 0,
      riskOverlapCount: riskFindings.length,
      state: issueRow.state,
    },
    linkedPrs,
    linkedCommits,
    files,
    riskFindings,
    recentComments,
  };
}
