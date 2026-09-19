import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { commits, prCommits, prFiles, pullRequests } from "../db/schema.js";
import {
  fetchGithubPullRequest,
  listGithubPullCommits,
  listGithubPullFiles,
  listGithubPullRequests,
} from "./github-provider.js";
import { getLogger } from "../utils/logger.js";
import { chunk } from "./sync-utils.js";

/**
 * Pull request ingestion (Phase 8). Read-only GitHub access, explicit
 * bounds, idempotent upserts. Called as a stage of repository sync —
 * never standalone against arbitrary repositories.
 */
export const PR_SYNC_BOUNDS = {
  /** PR list pages (50 per page) → at most 100 PRs considered. */
  prPages: 2,
  /** Hard cap on PRs ingested per sync run. */
  maxPrsPerSync: 50,
  /** Commit list pages (100 per page) per PR. */
  commitPagesPerPr: 2,
  /** Changed-file pages (100 per page) per PR. */
  filePagesPerPr: 1,
} as const;

function toDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function syncPullRequests(
  repositoryId: string,
  credential: string,
  owner: string,
  name: string,
): Promise<{ prCount: number }> {
  const logger = getLogger();
  const db = getDb();

  const listed = await listGithubPullRequests(credential, owner, name, {
    state: "all",
    maxPages: PR_SYNC_BOUNDS.prPages,
  });
  const selected = listed.slice(0, PR_SYNC_BOUNDS.maxPrsPerSync);
  logger.debug(
    { repositoryId, listed: listed.length, selected: selected.length },
    "Syncing pull requests",
  );

  for (const item of selected) {
    const detail = await fetchGithubPullRequest(
      credential,
      owner,
      name,
      item.number,
    );

    const upserted = await db
      .insert(pullRequests)
      .values({
        repositoryId,
        githubId: String(detail.id),
        number: detail.number,
        title: detail.title?.slice(0, 500) ?? null,
        body: detail.body?.slice(0, 20000) ?? null,
        state: detail.state,
        draft: detail.draft,
        merged: detail.merged,
        authorLogin: detail.authorLogin,
        authorGithubId:
          detail.authorGithubId !== null ? String(detail.authorGithubId) : null,
        sourceBranch: detail.sourceBranch,
        targetBranch: detail.targetBranch,
        headSha: detail.headSha,
        baseSha: detail.baseSha,
        mergeCommitSha: detail.mergeCommitSha,
        htmlUrl: detail.htmlUrl,
        additions: detail.additions,
        deletions: detail.deletions,
        changedFilesCount: detail.changedFiles,
        githubCreatedAt: toDate(detail.createdAt),
        githubUpdatedAt: toDate(detail.updatedAt),
        closedAt: toDate(detail.closedAt),
        mergedAt: toDate(detail.mergedAt),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [pullRequests.repositoryId, pullRequests.githubId],
        set: {
          title: detail.title?.slice(0, 500) ?? null,
          body: detail.body?.slice(0, 20000) ?? null,
          state: detail.state,
          draft: detail.draft,
          merged: detail.merged,
          authorLogin: detail.authorLogin,
          sourceBranch: detail.sourceBranch,
          targetBranch: detail.targetBranch,
          headSha: detail.headSha,
          baseSha: detail.baseSha,
          mergeCommitSha: detail.mergeCommitSha,
          htmlUrl: detail.htmlUrl,
          additions: detail.additions,
          deletions: detail.deletions,
          changedFilesCount: detail.changedFiles,
          githubUpdatedAt: toDate(detail.updatedAt),
          closedAt: toDate(detail.closedAt),
          mergedAt: toDate(detail.mergedAt),
          updatedAt: new Date(),
        },
      })
      .returning({ id: pullRequests.id });
    const prId = upserted[0].id;

    // PR ↔ commit links reuse existing commit rows (matched by SHA).
    // Commits absent locally (fork-only, beyond sync bounds) are skipped —
    // commit data is never duplicated for PRs.
    const prCommitsList = await listGithubPullCommits(
      credential,
      owner,
      name,
      detail.number,
      PR_SYNC_BOUNDS.commitPagesPerPr,
    );
    if (prCommitsList.length > 0) {
      const shas = [...new Set(prCommitsList.map((c) => c.sha))];
      const localIds: string[] = [];
      for (const shaChunk of chunk(shas, 100)) {
        const rows = await db
          .select({ id: commits.id })
          .from(commits)
          .where(
            and(
              eq(commits.repositoryId, repositoryId),
              inArray(commits.sha, shaChunk),
            ),
          );
        localIds.push(...rows.map((r) => r.id));
      }
      for (const idChunk of chunk(localIds, 200)) {
        await db
          .insert(prCommits)
          .values(idChunk.map((commitId) => ({ pullRequestId: prId, commitId })))
          .onConflictDoNothing({
            target: [prCommits.pullRequestId, prCommits.commitId],
          });
      }
    }

    // Changed-file metadata (no diffs, no patches).
    const prFileList = await listGithubPullFiles(
      credential,
      owner,
      name,
      detail.number,
      PR_SYNC_BOUNDS.filePagesPerPr,
    );
    for (const fileChunk of chunk(prFileList, 200)) {
      await db
        .insert(prFiles)
        .values(
          fileChunk.map((f) => ({
            pullRequestId: prId,
            repositoryId,
            path: f.path,
            previousPath: f.previousPath,
            sha: f.sha,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            changes: f.changes,
          })),
        )
        .onConflictDoUpdate({
          target: [prFiles.pullRequestId, prFiles.path],
          set: {
            previousPath: sql`excluded.previous_path`,
            sha: sql`excluded.sha`,
            status: sql`excluded.status`,
            additions: sql`excluded.additions`,
            deletions: sql`excluded.deletions`,
            changes: sql`excluded.changes`,
          },
        });
    }
  }

  return { prCount: selected.length };
}
