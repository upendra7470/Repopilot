import { and, count, desc, eq, ilike, max, or, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import {
  branches,
  ciRuns,
  ciWorkflows,
  commits,
  commitFiles,
  contributors,
  files,
  issues,
  pullRequests,
} from "../db/schema.js";
import { getLogger } from "../utils/logger.js";

/**
 * Engineering Memory (Phase 6): deterministic, factual history derived
 * exclusively from synced GitHub data in PostgreSQL. No ranking, no
 * scoring, no inference — only what the records evidence.
 */

export interface FileHistoryEntry {
  sha: string;
  message: string | null;
  authorLogin: string | null;
  committedAt: Date | null;
  status: string | null;
  additions: number | null;
  deletions: number | null;
}

export interface FileHistory {
  file: {
    id: string;
    path: string;
    type: string | null;
    size: number | null;
    sha: string | null;
  };
  changeCount: number;
  contributors: Array<{ login: string; changes: number }>;
  latestChange: FileHistoryEntry | null;
  history: FileHistoryEntry[];
}

export async function getFileHistory(
  repositoryId: string,
  fileId: string,
): Promise<FileHistory | null> {
  const db = getDb();
  const fileRows = await db
    .select()
    .from(files)
    .where(and(eq(files.repositoryId, repositoryId), eq(files.id, fileId)))
    .limit(1);
  const file = fileRows[0];
  if (!file) {
    return null;
  }

  const rows = await db
    .select({
      sha: commits.sha,
      message: commits.message,
      authorLogin: commits.authorLogin,
      committedAt: commits.committedAt,
      status: commitFiles.status,
      additions: commitFiles.additions,
      deletions: commitFiles.deletions,
    })
    .from(commitFiles)
    .innerJoin(commits, eq(commitFiles.commitId, commits.id))
    .where(
      and(
        eq(commitFiles.repositoryId, repositoryId),
        eq(commitFiles.path, file.path),
      ),
    )
    .orderBy(desc(commits.committedAt));

  const contributorCounts = new Map<string, number>();
  for (const row of rows) {
    const login = row.authorLogin ?? "(unknown)";
    contributorCounts.set(login, (contributorCounts.get(login) ?? 0) + 1);
  }

  const history: FileHistoryEntry[] = rows.map((row) => ({ ...row }));
  return {
    file: {
      id: file.id,
      path: file.path,
      type: file.type,
      size: file.size,
      sha: file.sha,
    },
    changeCount: rows.length,
    contributors: [...contributorCounts.entries()]
      .map(([login, changes]) => ({ login, changes }))
      .sort((a, b) => b.changes - a.changes),
    latestChange: history[0] ?? null,
    history,
  };
}

export interface ContributorActivity {
  contributor: {
    id: string;
    login: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
  };
  commitCount: number;
  filesTouched: number;
  firstCommitAt: Date | null;
  lastCommitAt: Date | null;
  frequentAreas: Array<{ area: string; changes: number }>;
  recentCommits: Array<{
    sha: string;
    message: string | null;
    committedAt: Date | null;
  }>;
}

/** Top-level directory (or "(root)") used as a deterministic area label. */
export function areaOfPath(path: string): string {
  const segment = path.split("/")[0];
  return segment && path.includes("/") ? segment : "(root)";
}

export async function getContributorActivity(
  repositoryId: string,
  contributorId: string,
): Promise<ContributorActivity | null> {
  const db = getDb();
  const personRows = await db
    .select()
    .from(contributors)
    .where(
      and(
        eq(contributors.repositoryId, repositoryId),
        eq(contributors.id, contributorId),
      ),
    )
    .limit(1);
  const person = personRows[0];
  if (!person) {
    return null;
  }

  const ownCommits = await db
    .select({
      id: commits.id,
      sha: commits.sha,
      message: commits.message,
      committedAt: commits.committedAt,
    })
    .from(commits)
    .where(
      and(
        eq(commits.repositoryId, repositoryId),
        eq(commits.contributorId, person.id),
      ),
    )
    .orderBy(desc(commits.committedAt));

  const commitIds = ownCommits.map((c) => c.id);
  let filesTouched = 0;
  const areaCounts = new Map<string, number>();
  if (commitIds.length > 0) {
    const touched = await db
      .select({ path: commitFiles.path })
      .from(commitFiles)
      .where(
        and(
          eq(commitFiles.repositoryId, repositoryId),
          sql`${commitFiles.commitId} IN (${sql.join(commitIds.map((id) => sql`${id}`), sql`, `)})`,
        ),
      );
    filesTouched = new Set(touched.map((t) => t.path)).size;
    for (const t of touched) {
      const area = areaOfPath(t.path);
      areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
    }
  }

  const dates = ownCommits
    .map((c) => c.committedAt?.getTime() ?? null)
    .filter((t): t is number => t !== null);

  return {
    contributor: {
      id: person.id,
      login: person.login,
      name: person.name,
      email: person.email,
      avatarUrl: person.avatarUrl,
    },
    commitCount: ownCommits.length,
    filesTouched,
    firstCommitAt: dates.length ? new Date(Math.min(...dates)) : null,
    lastCommitAt: dates.length ? new Date(Math.max(...dates)) : null,
    frequentAreas: [...areaCounts.entries()]
      .map(([area, changes]) => ({ area, changes }))
      .sort((a, b) => b.changes - a.changes)
      .slice(0, 10),
    recentCommits: ownCommits.slice(0, 10).map((c) => ({
      sha: c.sha,
      message: c.message,
      committedAt: c.committedAt,
    })),
  };
}

export interface ActivityEvent {
  kind: "commit" | "branch";
  sha: string | null;
  title: string;
  authorLogin: string | null;
  at: Date | null;
}

/** Recent engineering activity: commits (and branch updates) newest first. */
export async function getRecentActivity(
  repositoryId: string,
  limit = 20,
): Promise<ActivityEvent[]> {
  const db = getDb();
  const safeLimit = Math.min(Math.max(1, limit), 100);

  const recentCommits = await db
    .select({
      sha: commits.sha,
      message: commits.message,
      authorLogin: commits.authorLogin,
      committedAt: commits.committedAt,
    })
    .from(commits)
    .where(eq(commits.repositoryId, repositoryId))
    .orderBy(desc(commits.committedAt))
    .limit(safeLimit);

  return recentCommits.map((c) => ({
    kind: "commit" as const,
    sha: c.sha,
    title: (c.message ?? "(no message)").split("\n")[0],
    authorLogin: c.authorLogin,
    at: c.committedAt,
  }));
}

export interface ChangedFileStat {
  path: string;
  changes: number;
  contributors: number;
  additions: number;
  deletions: number;
}

/** Files ordered by observed change frequency (deterministic). */
export async function getFrequentlyChangedFiles(
  repositoryId: string,
  limit = 20,
): Promise<ChangedFileStat[]> {
  const db = getDb();
  const safeLimit = Math.min(Math.max(1, limit), 100);

  const rows = await db
    .select({
      path: commitFiles.path,
      changes: count(commitFiles.id),
      contributors: sql<number>`count(distinct ${commits.contributorId})`,
      additions: sql<number>`coalesce(sum(${commitFiles.additions}), 0)`,
      deletions: sql<number>`coalesce(sum(${commitFiles.deletions}), 0)`,
    })
    .from(commitFiles)
    .innerJoin(commits, eq(commitFiles.commitId, commits.id))
    .where(eq(commitFiles.repositoryId, repositoryId))
    .groupBy(commitFiles.path)
    .orderBy(desc(count(commitFiles.id)))
    .limit(safeLimit);

  return rows.map((row) => ({
    path: row.path,
    changes: Number(row.changes),
    contributors: Number(row.contributors),
    additions: Number(row.additions),
    deletions: Number(row.deletions),
  }));
}

export interface ContributorSummary {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  commitCount: number;
  lastCommitAt: Date | null;
}

/** Contributors ordered by observed commit count (descriptive, not ranked). */
export async function getContributorSummaries(
  repositoryId: string,
): Promise<ContributorSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: contributors.id,
      login: contributors.login,
      name: contributors.name,
      avatarUrl: contributors.avatarUrl,
      commitCount: count(commits.id),
      lastCommitAt: max(commits.committedAt),
    })
    .from(contributors)
    .leftJoin(
      commits,
      and(
        eq(commits.repositoryId, repositoryId),
        eq(commits.contributorId, contributors.id),
      ),
    )
    .where(eq(contributors.repositoryId, repositoryId))
    .groupBy(
      contributors.id,
      contributors.login,
      contributors.name,
      contributors.avatarUrl,
    )
    .orderBy(desc(count(commits.id)));

  return rows.map((row) => ({
    id: row.id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatarUrl,
    commitCount: Number(row.commitCount),
    lastCommitAt: row.lastCommitAt,
  }));
}

export interface AreaStat {
  area: string;
  files: number;
  changes: number;
}

/** Deterministic area grouping by top-level path segment. */
export async function getAreaStats(repositoryId: string): Promise<AreaStat[]> {
  const logger = getLogger();
  const db = getDb();

  logger.debug("Computing area stats");
  const fileRows = await db
    .select({ path: files.path })
    .from(files)
    .where(eq(files.repositoryId, repositoryId));

  const fileCounts = new Map<string, number>();
  for (const row of fileRows) {
    const area = areaOfPath(row.path);
    fileCounts.set(area, (fileCounts.get(area) ?? 0) + 1);
  }

  const changeRows = await db
    .select({ path: commitFiles.path })
    .from(commitFiles)
    .where(eq(commitFiles.repositoryId, repositoryId));
  const changeCounts = new Map<string, number>();
  for (const row of changeRows) {
    const area = areaOfPath(row.path);
    changeCounts.set(area, (changeCounts.get(area) ?? 0) + 1);
  }

  const areas = new Set([...fileCounts.keys(), ...changeCounts.keys()]);
  return [...areas]
    .map((area) => ({
      area,
      files: fileCounts.get(area) ?? 0,
      changes: changeCounts.get(area) ?? 0,
    }))
    .sort((a, b) => b.changes - a.changes || b.files - a.files);
}

export interface MemorySearchResult {
  files: Array<{ id: string; path: string; type: string | null }>;
  commits: Array<{
    sha: string;
    message: string | null;
    authorLogin: string | null;
    committedAt: Date | null;
  }>;
  contributors: Array<{ id: string; login: string; name: string | null }>;
}

/** Deterministic substring search over synced data (no semantic search). */
export async function searchMemory(
  repositoryId: string,
  query: string,
  limit = 20,
): Promise<MemorySearchResult> {
  const db = getDb();
  const safeLimit = Math.min(Math.max(1, limit), 50);
  const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;

  const [fileRows, commitRows, contributorRows] = await Promise.all([
    db
      .select({ id: files.id, path: files.path, type: files.type })
      .from(files)
      .where(
        and(eq(files.repositoryId, repositoryId), ilike(files.path, pattern)),
      )
      .limit(safeLimit),
    db
      .select({
        sha: commits.sha,
        message: commits.message,
        authorLogin: commits.authorLogin,
        committedAt: commits.committedAt,
      })
      .from(commits)
      .where(
        and(eq(commits.repositoryId, repositoryId), ilike(commits.message, pattern)),
      )
      .orderBy(desc(commits.committedAt))
      .limit(safeLimit),
    db
      .select({
        id: contributors.id,
        login: contributors.login,
        name: contributors.name,
      })
      .from(contributors)
      .where(
        and(
          eq(contributors.repositoryId, repositoryId),
          or(
            ilike(contributors.login, pattern),
            ilike(contributors.name, pattern),
          ),
        ),
      )
      .limit(safeLimit),
  ]);

  return { files: fileRows, commits: commitRows, contributors: contributorRows };
}

export interface MemoryOverview {
  counts: { branches: number; commits: number; files: number; contributors: number };
  recentActivity: ActivityEvent[];
  frequentlyChangedFiles: ChangedFileStat[];
  activeContributors: ContributorSummary[];
  areas: AreaStat[];
}

export async function getMemoryOverview(
  repositoryId: string,
): Promise<MemoryOverview> {
  const db = getDb();
  const [[b], [c], [f], [ct]] = await Promise.all([
    db
      .select({ n: count() })
      .from(branches)
      .where(eq(branches.repositoryId, repositoryId)),
    db
      .select({ n: count() })
      .from(commits)
      .where(eq(commits.repositoryId, repositoryId)),
    db
      .select({ n: count() })
      .from(files)
      .where(eq(files.repositoryId, repositoryId)),
    db
      .select({ n: count() })
      .from(contributors)
      .where(eq(contributors.repositoryId, repositoryId)),
  ]);

  const [recentActivity, frequentlyChangedFiles, summaries] =
    await Promise.all([
      getRecentActivity(repositoryId, 10),
      getFrequentlyChangedFiles(repositoryId, 10),
      getContributorSummaries(repositoryId),
    ]);

  // "Active" = most recently seen committing.
  const activeContributors = [...summaries]
    .sort(
      (a, b) =>
        (b.lastCommitAt?.getTime() ?? 0) - (a.lastCommitAt?.getTime() ?? 0),
    )
    .slice(0, 5);

  const areas = await getAreaStats(repositoryId);

  return {
    counts: { branches: b.n, commits: c.n, files: f.n, contributors: ct.n },
    recentActivity,
    frequentlyChangedFiles,
    activeContributors,
    areas: areas.slice(0, 10),
  };
}

export async function listRepositoryFiles(
  repositoryId: string,
  options: { prefix?: string; limit?: number } = {},
): Promise<Array<{ id: string; path: string; type: string | null; size: number | null; sha: string | null }>> {
  const db = getDb();
  const safeLimit = Math.min(Math.max(1, options.limit ?? 2000), 5000);
  const conditions = [eq(files.repositoryId, repositoryId)];
  if (options.prefix) {
    conditions.push(ilike(files.path, `${options.prefix.replace(/[%_\\]/g, "\\$&")}%`));
  }
  return db
    .select({
      id: files.id,
      path: files.path,
      type: files.type,
      size: files.size,
      sha: files.sha,
    })
    .from(files)
    .where(and(...conditions))
    .orderBy(files.path)
    .limit(safeLimit);
}

export async function getCommitsTouchingFile(
  repositoryId: string,
  path: string,
) {
  const db = getDb();
  return db
    .select({
      sha: commits.sha,
      message: commits.message,
      authorLogin: commits.authorLogin,
      committedAt: commits.committedAt,
      status: commitFiles.status,
    })
    .from(commitFiles)
    .innerJoin(commits, eq(commitFiles.commitId, commits.id))
    .where(
      and(
        eq(commitFiles.repositoryId, repositoryId),
        eq(commitFiles.path, path),
      ),
    )
    .orderBy(desc(commits.committedAt));
}

export async function getContributorsForFile(
  repositoryId: string,
  path: string,
): Promise<Array<{ login: string; changes: number }>> {
  const db = getDb();
  const rows = await db
    .select({ login: commits.authorLogin })
    .from(commitFiles)
    .innerJoin(commits, eq(commitFiles.commitId, commits.id))
    .where(
      and(
        eq(commitFiles.repositoryId, repositoryId),
        eq(commitFiles.path, path),
      ),
    );
  const counts = new Map<string, number>();
  for (const row of rows) {
    const login = row.login ?? "(unknown)";
    counts.set(login, (counts.get(login) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([login, changes]) => ({ login, changes }))
    .sort((a, b) => b.changes - a.changes);
}

export async function getFilesChangedByContributor(
  repositoryId: string,
  contributorId: string,
): Promise<Array<{ path: string; changes: number }>> {
  const db = getDb();
  const ownCommitIds = (
    await db
      .select({ id: commits.id })
      .from(commits)
      .where(
        and(
          eq(commits.repositoryId, repositoryId),
          eq(commits.contributorId, contributorId),
        ),
      )
  ).map((c) => c.id);
  if (ownCommitIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ path: commitFiles.path })
    .from(commitFiles)
    .where(
      and(
        eq(commitFiles.repositoryId, repositoryId),
        sql`${commitFiles.commitId} IN (${sql.join(ownCommitIds.map((id) => sql`${id}`), sql`, `)})`,
      ),
    );
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.path, (counts.get(row.path) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([path, changes]) => ({ path, changes }))
    .sort((a, b) => b.changes - a.changes);
}

export interface TimelineRef {
  entity: "commit" | "pr" | "issue" | "run";
  /** commit SHA, PR/issue number, or run GitHub ID. */
  value: string;
}

export interface TimelineItem {
  kind: "commit" | "pr" | "issue" | "ci_run";
  at: Date | null;
  title: string;
  subtitle: string | null;
  authorLogin: string | null;
  /** Current state (commit message n/a): PR state, issue state, run conclusion. */
  state: string | null;
  ref: TimelineRef;
  workflowName: string | null;
}

/**
 * Engineering timeline (Phase 10.1): one chronological stream across
 * commits, PRs, issues, and CI runs. Every item carries its entity
 * reference so the UI can navigate to the real investigation surface.
 * Titles are neutral noun phrases with observed state — verbs like
 * "opened" are never invented (only `merged` is certain from the record).
 */
export async function getEngineeringTimeline(
  repositoryId: string,
  limit = 30,
): Promise<TimelineItem[]> {
  const db = getDb();
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const perKind = Math.min(Math.max(10, safeLimit), 50);

  const [commitRows, prRows, issueRows, runRows, workflowRows] = await Promise.all([
    db
      .select({
        sha: commits.sha,
        message: commits.message,
        authorLogin: commits.authorLogin,
        committedAt: commits.committedAt,
      })
      .from(commits)
      .where(eq(commits.repositoryId, repositoryId))
      .orderBy(desc(commits.committedAt))
      .limit(perKind),
    db
      .select({
        number: pullRequests.number,
        title: pullRequests.title,
        state: pullRequests.state,
        merged: pullRequests.merged,
        authorLogin: pullRequests.authorLogin,
        githubUpdatedAt: pullRequests.githubUpdatedAt,
      })
      .from(pullRequests)
      .where(eq(pullRequests.repositoryId, repositoryId))
      .orderBy(desc(pullRequests.githubUpdatedAt))
      .limit(perKind),
    db
      .select({
        number: issues.number,
        title: issues.title,
        state: issues.state,
        authorLogin: issues.authorLogin,
        githubUpdatedAt: issues.githubUpdatedAt,
      })
      .from(issues)
      .where(eq(issues.repositoryId, repositoryId))
      .orderBy(desc(issues.githubUpdatedAt))
      .limit(perKind),
    db
      .select({
        githubId: ciRuns.githubId,
        runNumber: ciRuns.runNumber,
        status: ciRuns.status,
        conclusion: ciRuns.conclusion,
        headBranch: ciRuns.headBranch,
        workflowId: ciRuns.workflowId,
        githubCreatedAt: ciRuns.githubCreatedAt,
      })
      .from(ciRuns)
      .where(eq(ciRuns.repositoryId, repositoryId))
      .orderBy(desc(ciRuns.githubCreatedAt))
      .limit(perKind),
    db
      .select({ id: ciWorkflows.id, name: ciWorkflows.name })
      .from(ciWorkflows)
      .where(eq(ciWorkflows.repositoryId, repositoryId)),
  ]);
  const workflowNameById = new Map(workflowRows.map((w) => [w.id, w.name]));

  const items: TimelineItem[] = [
    ...commitRows.map((c): TimelineItem => ({
      kind: "commit",
      at: c.committedAt,
      title: (c.message ?? "(no message)").split("\n")[0],
      subtitle: c.sha.slice(0, 7),
      authorLogin: c.authorLogin,
      state: null,
      ref: { entity: "commit", value: c.sha },
      workflowName: null,
    })),
    ...prRows.map((pr): TimelineItem => ({
      kind: "pr",
      at: pr.githubUpdatedAt,
      title: `PR #${pr.number} · ${pr.title ?? "(no title)"}`,
      subtitle: pr.merged ? "merged" : pr.state,
      authorLogin: pr.authorLogin,
      state: pr.merged ? "merged" : pr.state,
      ref: { entity: "pr", value: String(pr.number) },
      workflowName: null,
    })),
    ...issueRows.map((issue): TimelineItem => ({
      kind: "issue",
      at: issue.githubUpdatedAt,
      title: `Issue #${issue.number} · ${issue.title ?? "(no title)"}`,
      subtitle: issue.state,
      authorLogin: issue.authorLogin,
      state: issue.state,
      ref: { entity: "issue", value: String(issue.number) },
      workflowName: null,
    })),
    ...runRows.map((run): TimelineItem => ({
      kind: "ci_run",
      at: run.githubCreatedAt,
      title: `${workflowNameById.get(run.workflowId) ?? "Workflow"} #${run.runNumber ?? run.githubId}`,
      subtitle: run.status === "completed" ? (run.conclusion ?? "completed") : (run.status ?? "running"),
      authorLogin: null,
      state: run.status === "completed" ? run.conclusion : run.status,
      ref: { entity: "run", value: run.githubId },
      workflowName: workflowNameById.get(run.workflowId) ?? null,
    })),
  ];

  const timeOf = (at: Date | null): number => {
    const ms = at?.getTime() ?? Number.NaN;
    return Number.isNaN(ms) ? -1 : ms;
  };
  return items
    .sort((a, b) => timeOf(b.at) - timeOf(a.at))
    .slice(0, safeLimit);
}
