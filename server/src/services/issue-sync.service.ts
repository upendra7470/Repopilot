import { and, eq, notInArray, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import {
  commits,
  issueCommitLinks,
  issueComments,
  issuePrLinks,
  issues,
  pullRequests,
} from "../db/schema.js";
import {
  listGithubIssueComments,
  listGithubIssues,
} from "./github-provider.js";
import { getLogger } from "../utils/logger.js";
import { chunk } from "./sync-utils.js";

/**
 * Issue ingestion (Phase 9). Read-only GitHub access, explicit bounds,
 * idempotent upserts. Runs as a stage of repository sync AFTER pull
 * requests so issue↔PR links resolve against freshly synced PRs —
 * never standalone against arbitrary repositories.
 */
export const ISSUE_SYNC_BOUNDS = {
  /** Issue list pages (100 per page) → at most 200 issues considered. */
  issuePages: 2,
  /** Hard cap on issues ingested per sync run. */
  maxIssuesPerSync: 50,
  /** Comment list pages (100 per page) per issue. */
  commentPagesPerIssue: 1,
  /** Newest comments kept per issue; older rows are pruned. */
  maxCommentsPerIssue: 20,
  /** Longest comment body persisted (truncated, never full dumps). */
  maxCommentChars: 5000,
  /** Longest issue body persisted (matches PR bound). */
  maxIssueBodyChars: 20000,
} as const;

/** Closing keywords per GitHub docs (fixes/closes/resolves + variants). */
const CLOSING_PATTERN =
  /\b(fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d+)\b/gi;
/** Any explicit issue reference: #42, GH-42, owner/repo#42. */
const REFERENCE_PATTERN =
  /(?:^|[\s([])(?:GH-)?(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d+)\b/gi;

function toDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function truncate(value: string | null, max: number): string | null {
  if (value === null) {
    return null;
  }
  return value.length > max ? value.slice(0, max) : value;
}

/** Distinct issue numbers referenced with closing keywords in PR text. */
function closingReferences(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(CLOSING_PATTERN)) {
    const number = Number.parseInt(match[2], 10);
    if (number >= 1) {
      found.add(number);
    }
  }
  return [...found];
}

/** Distinct issue numbers referenced at all (`#n`, `GH-n`, `o/r#n`). */
function allReferences(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(REFERENCE_PATTERN)) {
    const number = Number.parseInt(match[1], 10);
    if (number >= 1) {
      found.add(number);
    }
  }
  return [...found];
}

export async function syncIssues(
  repositoryId: string,
  credential: string,
  owner: string,
  name: string,
): Promise<{
  issueCount: number;
  commentCount: number;
  prLinkCount: number;
  commitLinkCount: number;
}> {
  const logger = getLogger();
  const db = getDb();

  const listed = await listGithubIssues(credential, owner, name, {
    state: "all",
    maxPages: ISSUE_SYNC_BOUNDS.issuePages,
  });
  const selected = listed.slice(0, ISSUE_SYNC_BOUNDS.maxIssuesPerSync);
  logger.debug(
    { repositoryId, listed: listed.length, selected: selected.length },
    "Syncing issues",
  );

  // Local issue identity for relationship resolution (number → id).
  const numberToId = new Map<number, string>();
  let commentCount = 0;

  for (const item of selected) {
    const labels = [...new Set(item.labels)].sort().slice(0, 50);
    const assignees = [...new Set(item.assignees)].sort().slice(0, 20);
    const upserted = await db
      .insert(issues)
      .values({
        repositoryId,
        githubId: String(item.id),
        number: item.number,
        title: item.title?.slice(0, 500) ?? null,
        body: truncate(item.body, ISSUE_SYNC_BOUNDS.maxIssueBodyChars),
        state: item.state,
        stateReason: item.stateReason?.slice(0, 50) ?? null,
        authorLogin: item.authorLogin,
        authorGithubId:
          item.authorGithubId !== null ? String(item.authorGithubId) : null,
        authorAssociation: item.authorAssociation?.slice(0, 50) ?? null,
        htmlUrl: item.htmlUrl,
        locked: item.locked,
        commentsCount: item.commentsCount,
        labels,
        milestoneNumber: item.milestoneNumber,
        milestoneTitle: item.milestoneTitle?.slice(0, 255) ?? null,
        milestoneState: item.milestoneState?.slice(0, 20) ?? null,
        assignees,
        githubCreatedAt: toDate(item.createdAt),
        githubUpdatedAt: toDate(item.updatedAt),
        closedAt: toDate(item.closedAt),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [issues.repositoryId, issues.githubId],
        set: {
          title: item.title?.slice(0, 500) ?? null,
          body: truncate(item.body, ISSUE_SYNC_BOUNDS.maxIssueBodyChars),
          state: item.state,
          stateReason: item.stateReason?.slice(0, 50) ?? null,
          authorLogin: item.authorLogin,
          locked: item.locked,
          commentsCount: item.commentsCount,
          labels,
          milestoneNumber: item.milestoneNumber,
          milestoneTitle: item.milestoneTitle?.slice(0, 255) ?? null,
          milestoneState: item.milestoneState?.slice(0, 20) ?? null,
          assignees,
          githubUpdatedAt: toDate(item.updatedAt),
          closedAt: toDate(item.closedAt),
          updatedAt: new Date(),
        },
      })
      .returning({ id: issues.id });
    const issueId = upserted[0].id;
    numberToId.set(item.number, issueId);

    // Bounded recent comments (newest tail); older rows pruned.
    if (item.commentsCount > 0) {
      const fetched = await listGithubIssueComments(
        credential,
        owner,
        name,
        item.number,
        ISSUE_SYNC_BOUNDS.commentPagesPerIssue,
      );
      const recent = fetched.slice(-ISSUE_SYNC_BOUNDS.maxCommentsPerIssue);
      const keptGithubIds: string[] = [];
      for (const commentChunk of chunk(recent, 100)) {
        await db
          .insert(issueComments)
          .values(
            commentChunk.map((c) => ({
              issueId,
              repositoryId,
              githubId: String(c.id),
              authorLogin: c.authorLogin,
              body: truncate(c.body, ISSUE_SYNC_BOUNDS.maxCommentChars),
              githubCreatedAt: toDate(c.createdAt),
              githubUpdatedAt: toDate(c.updatedAt),
            })),
          )
          .onConflictDoUpdate({
            target: [issueComments.issueId, issueComments.githubId],
            set: {
              authorLogin: sql`excluded.author_login`,
              body: sql`excluded.body`,
              githubUpdatedAt: sql`excluded.github_updated_at`,
            },
          });
        keptGithubIds.push(...commentChunk.map((c) => String(c.id)));
      }
      if (keptGithubIds.length > 0) {
        // Prune comments that fell out of the retained window (single
        // statement over the full kept set — never per-chunk).
        await db
          .delete(issueComments)
          .where(
            and(
              eq(issueComments.issueId, issueId),
              notInArray(issueComments.githubId, keptGithubIds),
            ),
          );
      }
      commentCount += recent.length;
    }
  }

  // Refresh the number map with every local issue (relationships may target
  // issues outside this sync's selection, e.g. older closed issues).
  const localIssues = await db
    .select({ id: issues.id, number: issues.number })
    .from(issues)
    .where(eq(issues.repositoryId, repositoryId));
  for (const row of localIssues) {
    numberToId.set(row.number, row.id);
  }

  // Issue ↔ PR links from explicit references in PR title/body.
  let prLinkCount = 0;
  const localPrs = await db
    .select({
      id: pullRequests.id,
      number: pullRequests.number,
      title: pullRequests.title,
      body: pullRequests.body,
    })
    .from(pullRequests)
    .where(eq(pullRequests.repositoryId, repositoryId));
  const prLinkRows: Array<{
    issueId: string;
    pullRequestId: string;
    repositoryId: string;
    relation: string;
    evidence: string | null;
  }> = [];
  for (const pr of localPrs) {
    const text = `${pr.title ?? ""}\n${pr.body ?? ""}`;
    const closed = new Set(closingReferences(text));
    for (const number of closed) {
      const issueId = numberToId.get(number);
      if (issueId) {
        prLinkRows.push({
          issueId,
          pullRequestId: pr.id,
          repositoryId,
          relation: "closed_by",
          evidence: `pr-body:${pr.number}:closes #${number}`.slice(0, 500),
        });
      }
    }
    for (const number of allReferences(text)) {
      const issueId = numberToId.get(number);
      if (issueId && !closed.has(number)) {
        prLinkRows.push({
          issueId,
          pullRequestId: pr.id,
          repositoryId,
          relation: "referenced_by",
          evidence: `pr-body:${pr.number}:refs #${number}`.slice(0, 500),
        });
      }
    }
  }
  for (const linkChunk of chunk(prLinkRows, 200)) {
    await db
      .insert(issuePrLinks)
      .values(linkChunk)
      .onConflictDoNothing({
        target: [
          issuePrLinks.issueId,
          issuePrLinks.pullRequestId,
          issuePrLinks.relation,
        ],
      });
    prLinkCount += linkChunk.length;
  }

  // Issue ↔ commit links from explicit references in commit messages.
  let commitLinkCount = 0;
  const localCommits = await db
    .select({ id: commits.id, sha: commits.sha, message: commits.message })
    .from(commits)
    .where(eq(commits.repositoryId, repositoryId));
  const commitLinkRows: Array<{
    issueId: string;
    commitId: string;
    repositoryId: string;
    evidence: string | null;
  }> = [];
  for (const commit of localCommits) {
    for (const number of allReferences(commit.message ?? "")) {
      const issueId = numberToId.get(number);
      if (issueId) {
        commitLinkRows.push({
          issueId,
          commitId: commit.id,
          repositoryId,
          evidence: `commit-message:${commit.sha.slice(0, 12)}:#${number}`.slice(0, 500),
        });
      }
    }
  }
  for (const linkChunk of chunk(commitLinkRows, 200)) {
    await db
      .insert(issueCommitLinks)
      .values(linkChunk)
      .onConflictDoNothing({
        target: [issueCommitLinks.issueId, issueCommitLinks.commitId],
      });
    commitLinkCount += linkChunk.length;
  }

  logger.debug(
    { repositoryId, issues: selected.length, comments: commentCount, prLinks: prLinkCount, commitLinks: commitLinkCount },
    "Issue sync completed",
  );
  return {
    issueCount: selected.length,
    commentCount,
    prLinkCount,
    commitLinkCount,
  };
}
