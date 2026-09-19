import { and, eq, notInArray, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { ciJobs, ciRuns, ciWorkflows } from "../db/schema.js";
import {
  listGithubRunJobs,
  listGithubWorkflowRuns,
  listGithubWorkflows,
} from "./github-provider.js";
import { getLogger } from "../utils/logger.js";
import { chunk } from "./sync-utils.js";

/**
 * CI ingestion (Phase 10). Read-only GitHub Actions access, explicit
 * bounds, idempotent upserts. Runs as the final stage of repository sync —
 * never standalone against arbitrary repositories.
 *
 * Retention is deliberately bounded: only the most recent runs are kept,
 * so storage cannot grow without limit. Runs are MUTABLE — re-sync
 * refreshes status/conclusion in place, so in-progress runs transition to
 * their terminal state. Job logs, steps, and annotations are never
 * fetched: Phase 10 needs job outcomes, not log text.
 */
export const CI_SYNC_BOUNDS = {
  /** Workflow list pages (100 per page). */
  workflowPages: 1,
  /** Hard cap on workflows persisted per sync. */
  maxWorkflowsPerSync: 50,
  /** Run list pages (100 per page, newest first). */
  runPages: 2,
  /** Retention cap: most recent runs kept per repository. */
  maxRunsPerSync: 100,
  /** Most recent runs for which jobs are fetched. */
  runsWithJobs: 30,
  /** Jobs kept per run. */
  maxJobsPerRun: 20,
} as const;

function toDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toSeconds(start: Date | null, end: Date | null): number | null {
  if (!start || !end) {
    return null;
  }
  const seconds = Math.round((end.getTime() - start.getTime()) / 1000);
  return seconds >= 0 ? seconds : null;
}

function timeValue(value: string | null): number {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

export async function syncCi(
  repositoryId: string,
  credential: string,
  owner: string,
  name: string,
): Promise<{ workflowCount: number; runCount: number; jobCount: number }> {
  const logger = getLogger();
  const db = getDb();
  logger.debug({ repositoryId }, "Syncing CI workflows and runs");

  // 1. Workflows (stable identity = GitHub workflow ID, never the name).
  const listedWorkflows = await listGithubWorkflows(
    credential,
    owner,
    name,
    CI_SYNC_BOUNDS.workflowPages,
  );
  const selectedWorkflows = listedWorkflows.slice(0, CI_SYNC_BOUNDS.maxWorkflowsPerSync);
  const workflowIdByGithubId = new Map<string, string>();
  for (const wfChunk of chunk(selectedWorkflows, 100)) {
    const upserted = await db
      .insert(ciWorkflows)
      .values(
        wfChunk.map((wf) => ({
          repositoryId,
          githubId: String(wf.id),
          name: wf.name?.slice(0, 255) ?? null,
          path: wf.path,
          state: wf.state?.slice(0, 30) ?? null,
          badgeUrl: wf.badgeUrl,
          htmlUrl: wf.htmlUrl,
          githubCreatedAt: toDate(wf.createdAt),
          githubUpdatedAt: toDate(wf.updatedAt),
          updatedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [ciWorkflows.repositoryId, ciWorkflows.githubId],
        set: {
          name: sql`excluded.name`,
          path: sql`excluded.path`,
          state: sql`excluded.state`,
          badgeUrl: sql`excluded.badge_url`,
          htmlUrl: sql`excluded.html_url`,
          githubUpdatedAt: sql`excluded.github_updated_at`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: ciWorkflows.id, githubId: ciWorkflows.githubId });
    for (const row of upserted) {
      workflowIdByGithubId.set(row.githubId, row.id);
    }
  }
  // Resolve IDs for workflows that already existed (returning only covers
  // upserted rows on some paths — re-read to be certain).
  if (workflowIdByGithubId.size < selectedWorkflows.length) {
    const existing = await db
      .select({ id: ciWorkflows.id, githubId: ciWorkflows.githubId })
      .from(ciWorkflows)
      .where(eq(ciWorkflows.repositoryId, repositoryId));
    for (const row of existing) {
      workflowIdByGithubId.set(row.githubId, row.id);
    }
  }

  // 2. Runs (newest first; retention-capped; mutable status/conclusion).
  const listedRuns = await listGithubWorkflowRuns(
    credential,
    owner,
    name,
    CI_SYNC_BOUNDS.runPages,
  );
  const selectedRuns = [...listedRuns]
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))
    .slice(0, CI_SYNC_BOUNDS.maxRunsPerSync);

  const runIdByGithubId = new Map<string, string>();
  for (const run of selectedRuns) {
    const workflowId = run.workflowId !== null
      ? (workflowIdByGithubId.get(String(run.workflowId)) ?? null)
      : null;
    if (!workflowId) {
      // The run's workflow is unknown (beyond the workflow cap or removed
      // upstream) — skipping keeps the workflow→run hierarchy truthful.
      continue;
    }
    const startedAt = toDate(run.startedAt);
    // List payloads carry no completed_at; for terminal runs updated_at is
    // the last state change, which approximates completion.
    const completedAt = run.conclusion ? toDate(run.updatedAt) : null;
    const prNumbers = [...new Set(run.prNumbers)]
      .filter((n) => Number.isInteger(n) && n >= 1)
      .sort((a, b) => a - b)
      .slice(0, 50);
    const upserted = await db
      .insert(ciRuns)
      .values({
        repositoryId,
        workflowId,
        githubId: String(run.id),
        runNumber: run.runNumber,
        name: run.name?.slice(0, 255) ?? null,
        event: run.event?.slice(0, 50) ?? null,
        status: run.status?.slice(0, 30) ?? null,
        conclusion: run.conclusion?.slice(0, 30) ?? null,
        headBranch: run.headBranch?.slice(0, 255) ?? null,
        headSha: run.headSha,
        runAttempt: run.runAttempt,
        actorLogin: run.actorLogin?.slice(0, 255) ?? null,
        prNumbers,
        htmlUrl: run.htmlUrl,
        durationSec: toSeconds(startedAt, completedAt),
        githubCreatedAt: toDate(run.createdAt),
        githubUpdatedAt: toDate(run.updatedAt),
        startedAt,
        completedAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [ciRuns.repositoryId, ciRuns.githubId],
        set: {
          workflowId: sql`excluded.workflow_id`,
          runNumber: sql`excluded.run_number`,
          name: sql`excluded.name`,
          event: sql`excluded.event`,
          status: sql`excluded.status`,
          conclusion: sql`excluded.conclusion`,
          headBranch: sql`excluded.head_branch`,
          headSha: sql`excluded.head_sha`,
          runAttempt: sql`excluded.run_attempt`,
          actorLogin: sql`excluded.actor_login`,
          prNumbers: sql`excluded.pr_numbers`,
          htmlUrl: sql`excluded.html_url`,
          durationSec: sql`excluded.duration_sec`,
          githubUpdatedAt: sql`excluded.github_updated_at`,
          startedAt: sql`excluded.started_at`,
          completedAt: sql`excluded.completed_at`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: ciRuns.id, githubId: ciRuns.githubId });
    const row = upserted[0];
    if (row) {
      runIdByGithubId.set(row.githubId, row.id);
    }
  }

  // Prune runs that fell outside retention (jobs cascade). Single
  // statement over the full kept set — never per-chunk. An empty kept set
  // after a successful listing means no runs exist upstream: clear them.
  const keptRunGithubIds = [...runIdByGithubId.keys()];
  if (keptRunGithubIds.length > 0) {
    await db
      .delete(ciRuns)
      .where(
        and(
          eq(ciRuns.repositoryId, repositoryId),
          notInArray(ciRuns.githubId, keptRunGithubIds),
        ),
      );
  } else {
    await db.delete(ciRuns).where(eq(ciRuns.repositoryId, repositoryId));
  }

  // 3. Jobs for the most recent runs only (outcome metadata, no logs).
  let jobCount = 0;
  const recentRuns = selectedRuns.slice(0, CI_SYNC_BOUNDS.runsWithJobs);
  for (const run of recentRuns) {
    const runId = runIdByGithubId.get(String(run.id));
    if (!runId) {
      continue;
    }
    const listedJobs = await listGithubRunJobs(
      credential,
      owner,
      name,
      run.id,
      1,
    );
    const kept = listedJobs.slice(0, CI_SYNC_BOUNDS.maxJobsPerRun);
    const keptGithubIds: string[] = [];
    for (const jobChunk of chunk(kept, 100)) {
      await db
        .insert(ciJobs)
        .values(
          jobChunk.map((job) => {
            const startedAt = toDate(job.startedAt);
            const completedAt = toDate(job.completedAt);
            return {
              runId,
              repositoryId,
              githubId: String(job.id),
              name: job.name?.slice(0, 255) ?? null,
              status: job.status?.slice(0, 30) ?? null,
              conclusion: job.conclusion?.slice(0, 30) ?? null,
              startedAt,
              completedAt,
              durationSec: toSeconds(startedAt, completedAt),
              htmlUrl: job.htmlUrl,
            };
          }),
        )
        .onConflictDoUpdate({
          target: [ciJobs.runId, ciJobs.githubId],
          set: {
            name: sql`excluded.name`,
            status: sql`excluded.status`,
            conclusion: sql`excluded.conclusion`,
            startedAt: sql`excluded.started_at`,
            completedAt: sql`excluded.completed_at`,
            durationSec: sql`excluded.duration_sec`,
            htmlUrl: sql`excluded.html_url`,
          },
        });
      keptGithubIds.push(...jobChunk.map((job) => String(job.id)));
    }
    if (keptGithubIds.length > 0) {
      await db
        .delete(ciJobs)
        .where(
          and(eq(ciJobs.runId, runId), notInArray(ciJobs.githubId, keptGithubIds)),
        );
    }
    jobCount += kept.length;
  }

  logger.debug(
    {
      repositoryId,
      workflows: selectedWorkflows.length,
      runs: runIdByGithubId.size,
      jobs: jobCount,
    },
    "CI sync completed",
  );
  return {
    workflowCount: selectedWorkflows.length,
    runCount: runIdByGithubId.size,
    jobCount,
  };
}
