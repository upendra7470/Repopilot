import { and, count, desc, eq, inArray, lt, max, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import {
  branches,
  commits,
  commitFiles,
  contributors,
  files,
  repositories,
  syncRuns,
} from "../db/schema.js";
import { getGithubCredential, githubTokenHasRepoScope } from "./credential-store.js";
import {
  fetchGithubCommitFiles,
  fetchGithubRepoMetadata,
  fetchGithubTree,
  GithubApiError,
  listGithubBranches,
  listGithubCommits,
} from "./github-provider.js";
import { userHasRepositoryAccess } from "./repository.service.js";
import { getLogger } from "../utils/logger.js";
import { chunk } from "./sync-utils.js";
import { syncPullRequests } from "./pr-sync.service.js";
import { syncIssues } from "./issue-sync.service.js";

/** Domain error with an explicit HTTP mapping for the route layer. */
export type SyncHttpStatus = 400 | 403 | 404 | 409 | 502 | 503;

export class SyncError extends Error {
  readonly httpStatus: SyncHttpStatus;
  readonly code: string;

  constructor(httpStatus: SyncHttpStatus, code: string, message: string) {
    super(message);
    this.name = "SyncError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

export interface SyncSummary {
  runId: string;
  status: "succeeded";
  branchCount: number;
  commitCount: number;
  fileCount: number;
  contributorCount: number;
  prCount: number;
  issueCount: number;
  truncatedTree: boolean;
  durationMs: number;
}

/** Sync bounds: predictable request count, no unbounded loops. */
export const SYNC_BOUNDS = {
  branchPages: 2,
  commitPages: 3,
  commitDetails: 30,
  bulkChunk: 500,
} as const;

/** Runs stuck in RUNNING longer than this are treated as stale/crashed. */
export const STALE_RUN_MS = 30 * 60 * 1000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function recoverStaleRuns(repositoryId: string): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  await db
    .update(syncRuns)
    .set({
      status: "failed",
      errorCode: "STALE",
      errorMessage: "Sync did not complete (stale run recovered).",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(syncRuns.repositoryId, repositoryId),
        eq(syncRuns.status, "running"),
        lt(syncRuns.startedAt, cutoff),
      ),
    );
  await db
    .update(repositories)
    .set({ syncStatus: "failed" })
    .where(
      and(
        eq(repositories.id, repositoryId),
        eq(repositories.syncStatus, "running"),
      ),
    );
}

async function setRunStage(runId: string, stage: string): Promise<void> {
  await getDb()
    .update(syncRuns)
    .set({ stage })
    .where(eq(syncRuns.id, runId));
}

interface ContributorIdentity {
  githubId: string | null;
  login: string | null;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * Resolve (find-or-create) a contributor row. Prefers the stable GitHub ID;
 * falls back to login. Returns null when neither exists (anonymous commit).
 */
async function resolveContributor(
  repositoryId: string,
  identity: ContributorIdentity,
): Promise<string | null> {
  const db = getDb();
  const { githubId, login } = identity;
  if (!githubId && !login) {
    return null;
  }

  const matches = [];
  if (githubId) {
    matches.push(
      and(
        eq(contributors.repositoryId, repositoryId),
        eq(contributors.githubId, githubId),
      ),
    );
  }
  if (login) {
    matches.push(
      and(
        eq(contributors.repositoryId, repositoryId),
        eq(contributors.login, login),
      ),
    );
  }
  const existing = await db
    .select({ id: contributors.id })
    .from(contributors)
    .where(sql`${sql.join(matches, sql` OR `)}`)
    .limit(1);

  const values = {
    repositoryId,
    githubId,
    login: login ?? githubId ?? "unknown",
    name: identity.name,
    email: identity.email,
    avatarUrl: identity.avatarUrl,
    updatedAt: new Date(),
  };

  if (existing[0]) {
    await db
      .update(contributors)
      .set(values)
      .where(eq(contributors.id, existing[0].id));
    return existing[0].id;
  }
  const inserted = await db.insert(contributors).values(values).returning({
    id: contributors.id,
  });
  return inserted[0].id;
}

/**
 * Synchronize a connected repository (bounded, idempotent, incremental).
 *
 * Concurrency is guarded by the partial unique index
 * `sync_runs_one_running_idx`: a second concurrent sync fails the INSERT
 * and receives 409 SYNC_IN_PROGRESS. All persisted rows carry uniqueness
 * constraints so reruns and retries never duplicate data.
 */
export async function startRepositorySync(
  userId: string,
  repositoryId: string,
): Promise<SyncSummary> {
  const logger = getLogger();
  const db = getDb();
  const started = Date.now();

  if (!UUID_PATTERN.test(repositoryId)) {
    throw new SyncError(400, "INVALID_REPOSITORY", "Invalid repository id");
  }
  if (!(await userHasRepositoryAccess(userId, repositoryId))) {
    throw new SyncError(404, "REPOSITORY_NOT_FOUND", "Repository not found");
  }

  const repoRows = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .limit(1);
  const repo = repoRows[0];
  if (!repo) {
    throw new SyncError(404, "REPOSITORY_NOT_FOUND", "Repository not found");
  }

  const credential = await getGithubCredential(userId);
  if (!credential) {
    throw new GithubApiError(401, "GitHub credential missing");
  }
  if (repo.isPrivate && !(await githubTokenHasRepoScope(userId))) {
    throw new SyncError(
      403,
      "PRIVATE_REPO_REQUIRES_SCOPE",
      "Private repository ingestion requires the GitHub `repo` scope — " +
        "please sign in with GitHub again after the application requests it.",
    );
  }

  await recoverStaleRuns(repositoryId);

  let runId: string;
  try {
    const inserted = await db
      .insert(syncRuns)
      .values({ repositoryId, status: "running", stage: "starting" })
      .returning({ id: syncRuns.id });
    runId = inserted[0].id;
  } catch (err) {
    // Drizzle wraps PostgreSQL errors: the 23505 unique-violation code
    // lives on `cause`. This is the concurrent-sync guard backed by the
    // partial unique index `sync_runs_one_running_idx`.
    const pgCode =
      typeof err === "object" && err !== null
        ? ((err as { code?: string }).code ??
          (err as { cause?: { code?: string } }).cause?.code)
        : undefined;
    if (pgCode === "23505") {
      throw new SyncError(
        409,
        "SYNC_IN_PROGRESS",
        "A sync is already running for this repository.",
      );
    }
    throw err;
  }

  await db
    .update(repositories)
    .set({ syncStatus: "running" })
    .where(eq(repositories.id, repositoryId));

  const finishFailed = async (code: string, message: string) => {
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        errorCode: code,
        errorMessage: message,
        finishedAt: new Date(),
      })
      .where(eq(syncRuns.id, runId));
    await db
      .update(repositories)
      .set({ syncStatus: "failed", lastSyncedAt: new Date() })
      .where(eq(repositories.id, repositoryId));
  };

  try {
    logger.info({ userId, repositoryId }, "Repository sync started");

    // 1. Repository metadata refresh.
    await setRunStage(runId, "metadata");
    const metadata = await fetchGithubRepoMetadata(
      credential,
      repo.owner,
      repo.name,
    );
    if (metadata.isPrivate && !(await githubTokenHasRepoScope(userId))) {
      throw new SyncError(
        403,
        "PRIVATE_REPO_REQUIRES_SCOPE",
        "Private repository ingestion requires the GitHub `repo` scope — " +
          "please sign in with GitHub again after the application requests it.",
      );
    }
    await db
      .update(repositories)
      .set({
        fullName: metadata.fullName,
        description: metadata.description,
        defaultBranch: metadata.defaultBranch,
        isPrivate: metadata.isPrivate,
        htmlUrl: metadata.htmlUrl,
        archived: metadata.archived,
        fork: metadata.fork,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repositoryId));

    // 2. Branches (upsert by natural key — reruns update in place).
    await setRunStage(runId, "branches");
    const githubBranches = await listGithubBranches(
      credential,
      repo.owner,
      repo.name,
      SYNC_BOUNDS.branchPages,
    );
    for (const branchChunk of chunk(githubBranches, SYNC_BOUNDS.bulkChunk)) {
      await db
        .insert(branches)
        .values(
          branchChunk.map((b) => ({
            repositoryId,
            name: b.name,
            sha: b.sha,
            protected: b.isProtected,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [branches.repositoryId, branches.name],
          set: {
            sha: sql`excluded.sha`,
            protected: sql`excluded.protected`,
            updatedAt: new Date(),
          },
        });
    }
    const headSha =
      githubBranches.find((b) => b.name === metadata.defaultBranch)?.sha ??
      githubBranches[0]?.sha ??
      null;

    // 3. Commits, incremental via `since` (bounded pages regardless).
    await setRunStage(runId, "commits");
    const maxCommitted = await db
      .select({ value: max(commits.committedAt) })
      .from(commits)
      .where(eq(commits.repositoryId, repositoryId));
    const since = maxCommitted[0]?.value?.toISOString();
    const githubCommits = await listGithubCommits(
      credential,
      repo.owner,
      repo.name,
      {
        sha: headSha ?? undefined,
        since,
        maxPages: SYNC_BOUNDS.commitPages,
      },
    );

    const contributorIds = new Set<string>();
    let commitCount = 0;
    for (const gc of githubCommits) {
      const person =
        gc.author.login ?? gc.author.githubId
          ? gc.author
          : gc.committer.login ?? gc.committer.githubId
            ? gc.committer
            : null;
      const contributorId = person
        ? await resolveContributor(repositoryId, {
            githubId:
              person.githubId !== null ? String(person.githubId) : null,
            login: person.login,
            name: person.name,
            email: person.email,
            avatarUrl: person.avatarUrl,
          })
        : null;
      if (contributorId) {
        contributorIds.add(contributorId);
      }

      await db
        .insert(commits)
        .values({
          repositoryId,
          sha: gc.sha,
          message: gc.message,
          authorName: gc.author.name,
          authorEmail: gc.author.email,
          authorLogin: gc.author.login,
          authorGithubId:
            gc.author.githubId !== null ? String(gc.author.githubId) : null,
          committerName: gc.committer.name,
          committerEmail: gc.committer.email,
          committerLogin: gc.committer.login,
          contributorId,
          authoredAt: gc.author.date ? new Date(gc.author.date) : null,
          committedAt: gc.committer.date ? new Date(gc.committer.date) : null,
          url: gc.url,
          parentShas: gc.parents,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [commits.repositoryId, commits.sha],
          set: {
            message: sql`excluded.message`,
            contributorId: sql`excluded.contributor_id`,
            url: sql`excluded.url`,
            parentShas: sql`excluded.parent_shas`,
            updatedAt: new Date(),
          },
        });
      commitCount += 1;
    }

    // 4. Commit ↔ file relationships for the newest commits only (bounded).
    await setRunStage(runId, "commit_files");
    const recentShas = githubCommits
      .slice(0, SYNC_BOUNDS.commitDetails)
      .map((c) => c.sha);
    for (const sha of recentShas) {
      const commitRows = await db
        .select({ id: commits.id })
        .from(commits)
        .where(and(eq(commits.repositoryId, repositoryId), eq(commits.sha, sha)))
        .limit(1);
      const commitId = commitRows[0]?.id;
      if (!commitId) {
        continue;
      }
      const changed = await fetchGithubCommitFiles(
        credential,
        repo.owner,
        repo.name,
        sha,
      );
      if (changed.length === 0) {
        continue;
      }
      await db
        .insert(commitFiles)
        .values(
          changed.map((f) => ({
            commitId,
            repositoryId,
            path: f.path,
            sha: f.sha,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
          })),
        )
        .onConflictDoNothing({
          target: [commitFiles.commitId, commitFiles.path],
        });
    }

    // 5. File-tree snapshot for the default ref (single recursive call).
    await setRunStage(runId, "files");
    let fileCount = 0;
    let truncatedTree = false;
    if (headSha) {
      const tree = await fetchGithubTree(
        credential,
        repo.owner,
        repo.name,
        headSha,
      );
      truncatedTree = tree.truncated;
      const ref = metadata.defaultBranch;
      // Persist blobs only: directory/submodule entries inflate file counts
      // (directory structure is already implicit in blob paths) and would
      // violate the files_blob_only constraint.
      const blobEntries = tree.entries.filter((e) => e.type === "blob");
      for (const fileChunk of chunk(blobEntries, SYNC_BOUNDS.bulkChunk)) {
        await db
          .insert(files)
          .values(
            fileChunk.map((entry) => ({
              repositoryId,
              ref,
              path: entry.path,
              sha: entry.sha,
              type: entry.type,
              size: entry.size,
              mode: entry.mode,
              updatedAt: new Date(),
            })),
          )
          .onConflictDoUpdate({
            target: [files.repositoryId, files.ref, files.path],
            set: {
              sha: sql`excluded.sha`,
              type: sql`excluded.type`,
              size: sql`excluded.size`,
              mode: sql`excluded.mode`,
              updatedAt: new Date(),
            },
          });
      }
      fileCount = blobEntries.length;
      if (!tree.truncated) {
        // Full snapshot: drop paths that no longer exist.
        const currentPaths = new Set(blobEntries.map((e) => e.path));
        const stored = await db
          .select({ id: files.id, path: files.path })
          .from(files)
          .where(and(eq(files.repositoryId, repositoryId), eq(files.ref, ref)));
        const staleIds = stored
          .filter((row) => !currentPaths.has(row.path))
          .map((row) => row.id);
        for (const idChunk of chunk(staleIds, SYNC_BOUNDS.bulkChunk)) {
          await db.delete(files).where(inArray(files.id, idChunk));
        }
      }
    }

    // 6. Contributors derived above; count distinct touched + total.
    await setRunStage(runId, "contributors");

    // 7. Pull requests (bounded, read-only; own stage, own errors).
    await setRunStage(runId, "pull_requests");
    const { prCount } = await syncPullRequests(
      repositoryId,
      credential,
      repo.owner,
      repo.name,
    );

    // 8. Issues (bounded, read-only; runs after PRs so issue↔PR links
    // resolve against freshly synced PRs).
    await setRunStage(runId, "issues");
    const { issueCount } = await syncIssues(
      repositoryId,
      credential,
      repo.owner,
      repo.name,
    );

    const finishedAt = new Date();
    await db
      .update(syncRuns)
      .set({
        status: "succeeded",
        stage: "done",
        branchCount: githubBranches.length,
        commitCount,
        fileCount,
        contributorCount: contributorIds.size,
        prCount,
        issueCount,
        finishedAt,
      })
      .where(eq(syncRuns.id, runId));
    await db
      .update(repositories)
      .set({
        syncStatus: "succeeded",
        lastSyncedAt: finishedAt,
        lastSuccessfulSyncAt: finishedAt,
      })
      .where(eq(repositories.id, repositoryId));

    logger.info(
      {
        userId,
        repositoryId,
        branches: githubBranches.length,
        commits: commitCount,
        files: fileCount,
        prs: prCount,
        issues: issueCount,
      },
      "Repository sync succeeded",
    );

    return {
      runId,
      status: "succeeded",
      branchCount: githubBranches.length,
      commitCount,
      fileCount,
      contributorCount: contributorIds.size,
      prCount,
      issueCount,
      truncatedTree,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const code =
      err instanceof GithubApiError
        ? `GITHUB_${err.status || "NETWORK"}`
        : err instanceof SyncError
          ? err.code
          : "UNKNOWN";
    // Only classified errors carry safe messages; unknown failures must not
    // leak implementation details (or, worse, interpolated secrets) anywhere.
    const message =
      err instanceof GithubApiError || err instanceof SyncError
        ? err.message
        : "Repository sync failed unexpectedly";
    try {
      await finishFailed(code, message);
    } catch {
      // Recording the failure must never mask the original error (which is
      // what the caller — and the sync_runs row, when writable — reports).
      logger.error(
        { runId, repositoryId, stage: "record-failure" },
        "Failed to record sync failure",
      );
    }
    logger.error(
      { runId, repositoryId, code },
      "Repository sync failed",
    );
    throw err;
  }
}

/** Latest sync run for a repository (null when never synced). */
export async function getLatestSyncRun(repositoryId: string) {
  const rows = await getDb()
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.repositoryId, repositoryId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Real persisted counts backing the repository UI. */
export async function getRepositorySyncCounts(repositoryId: string) {
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
  return {
    branches: b.n,
    commits: c.n,
    files: f.n,
    contributors: ct.n,
  };
}
