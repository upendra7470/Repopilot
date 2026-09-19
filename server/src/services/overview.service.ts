import { getRepositoryById } from "./repository.service.js";
import { getRepositorySyncCounts } from "./repo-sync.service.js";
import { getEngineeringTimeline, getMemoryOverview } from "./memory.service.js";
import type { TimelineItem } from "./memory.service.js";
import { analyzeRepositoryRisks } from "./risk.service.js";
import { listPullRequests } from "./pr-intelligence.service.js";
import { listIssues } from "./issue-intelligence.service.js";
import { getCiSummary } from "./ci-intelligence.service.js";
import { getLogger } from "../utils/logger.js";

/**
 * Repository overview aggregate (Phase 10.1).
 *
 * A single bounded read composing EXISTING services — no duplicated
 * business logic. Every number and every attention item traces to a real
 * record with a navigation target. No health scores, no invented metrics.
 */

export interface AttentionItem {
  kind: "risk" | "ci" | "pr" | "issue";
  severity: string;
  title: string;
  detail: string;
  href: string;
}

export interface RepositoryOverview {
  repository: {
    id: string;
    fullName: string;
    owner: string;
    name: string;
    defaultBranch: string;
    isPrivate: boolean;
    syncStatus: string;
    lastSyncedAt: Date | null;
    lastSuccessfulSyncAt: Date | null;
  };
  counts: {
    branches: number;
    commits: number;
    files: number;
    contributors: number;
    prs: { open: number; merged: number; closed: number };
    issues: { open: number; closed: number };
    workflows: number;
    runs: number;
  };
  attention: AttentionItem[];
  recentEvents: TimelineItem[];
  recentPrs: Array<{
    number: number;
    title: string | null;
    state: string;
    merged: boolean;
    authorLogin: string | null;
    githubUpdatedAt: Date | null;
  }>;
  recentIssues: Array<{
    number: number;
    title: string | null;
    state: string;
    authorLogin: string | null;
    githubUpdatedAt: Date | null;
  }>;
  topContributors: Array<{
    login: string;
    name: string | null;
    commitCount: number;
    lastCommitAt: Date | null;
  }>;
  hotFiles: Array<{ path: string; changes: number }>;
}

const ATTENTION_CAP = 10;

export async function getRepositoryOverview(
  repositoryId: string,
): Promise<RepositoryOverview | null> {
  const logger = getLogger();
  const repo = await getRepositoryById(repositoryId);
  if (!repo) {
    return null;
  }

  const [syncCounts, riskReport, prs, openIssues, closedIssues, staleIssues, ci, events] =
    await Promise.all([
      getRepositorySyncCounts(repositoryId),
      analyzeRepositoryRisks(repositoryId),
      listPullRequests(repositoryId, "all"),
      listIssues(repositoryId, { state: "open", perPage: 1 }),
      listIssues(repositoryId, { state: "closed", perPage: 1 }),
      listIssues(repositoryId, { state: "open", signal: "stale_open", perPage: 5 }),
      getCiSummary(repositoryId),
      getEngineeringTimeline(repositoryId, 15),
    ]);

  const openPrs = prs.filter((p) => p.state === "open");
  const mergedPrs = prs.filter((p) => p.merged);
  const closedPrs = prs.filter((p) => p.state !== "open" && !p.merged);

  const attention: AttentionItem[] = [];
  const href = (path: string): string => `${path}?repositoryId=${repositoryId}`;

  // Risks first: critical/high findings with evidence behind them.
  const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const topRisks = [...riskReport.findings]
    .sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9))
    .slice(0, 5);
  for (const finding of topRisks) {
    if (finding.severity === "critical" || finding.severity === "high") {
      attention.push({
        kind: "risk",
        severity: finding.severity,
        title: finding.title,
        detail: finding.summary,
        href: href("/risks"),
      });
    }
  }

  // CI: streaks, recent failures, unstable workflows, PRs with failing CI.
  for (const streak of ci.failureStreaks.slice(0, 3)) {
    attention.push({
      kind: "ci",
      severity: streak.streak >= 5 ? "high" : "medium",
      title: `${streak.workflowName ?? "Workflow"}: ${streak.streak} consecutive failures`,
      detail: "Ongoing breakage — inspect the latest failed run and its commit.",
      href: href("/ci-cd"),
    });
  }
  for (const failed of ci.recentFailures.slice(0, 2)) {
    attention.push({
      kind: "ci",
      severity: "medium",
      title: `Failed: ${failed.workflowName ?? "Workflow"} #${failed.runNumber ?? failed.githubId}`,
      detail: `Conclusion ${failed.conclusion ?? "?"} on branch ${failed.headBranch ?? "?"} — inspect the run, not a diagnosis.`,
      href: href("/ci-cd"),
    });
  }
  for (const failed of ci.prCiStates.filter((p) => p.state === "failed").slice(0, 3)) {
    attention.push({
      kind: "pr",
      severity: "medium",
      title: `PR #${failed.prNumber} has failing CI`,
      detail: failed.prTitle ?? "Associated run failed.",
      href: href("/pull-requests"),
    });
  }
  for (const unstable of ci.unstableWorkflows.slice(0, 2)) {
    attention.push({
      kind: "ci",
      severity: "medium",
      title: `${unstable.workflowName ?? "Workflow"} unstable (${unstable.failures}/${unstable.window})`,
      detail: "Repeated success/failure oscillation.",
      href: href("/ci-cd"),
    });
  }

  // Stale issues: aging open work with no invented urgency.
  for (const stale of staleIssues.data.slice(0, 3)) {
    attention.push({
      kind: "issue",
      severity: "low",
      title: `Issue #${stale.number} open ${stale.dimensions.ageDays ?? "?"}d`,
      detail: stale.title ?? "Aging open issue.",
      href: href("/issues"),
    });
  }

  const recentPrs = [...prs]
    .sort(
      (a, b) =>
        (b.githubUpdatedAt?.getTime() ?? 0) - (a.githubUpdatedAt?.getTime() ?? 0),
    )
    .slice(0, 5)
    .map((p) => ({
      number: p.number,
      title: p.title,
      state: p.state,
      merged: p.merged,
      authorLogin: p.authorLogin,
      githubUpdatedAt: p.githubUpdatedAt,
    }));

  const recentIssues = openIssues.data.slice(0, 5).map((i) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    authorLogin: i.authorLogin,
    githubUpdatedAt: i.githubUpdatedAt,
  }));

  // Top contributors + hot files come from the memory overview's
  // ranked slices (same source the Contributors/Timeline views use).
  const memory = await getMemoryOverview(repositoryId);

  logger.debug(
    { repositoryId, attention: attention.length, events: events.length },
    "Repository overview computed",
  );

  return {
    repository: {
      id: repo.id,
      fullName: repo.fullName,
      owner: repo.owner,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
      isPrivate: repo.isPrivate,
      syncStatus: repo.syncStatus,
      lastSyncedAt: repo.lastSyncedAt,
      lastSuccessfulSyncAt: repo.lastSuccessfulSyncAt,
    },
    counts: {
      branches: syncCounts.branches,
      commits: syncCounts.commits,
      files: syncCounts.files,
      contributors: syncCounts.contributors,
      prs: { open: openPrs.length, merged: mergedPrs.length, closed: closedPrs.length },
      issues: { open: openIssues.pagination.total, closed: closedIssues.pagination.total },
      workflows: ci.counts.workflows,
      runs: ci.counts.runs,
    },
    attention: attention.slice(0, ATTENTION_CAP),
    recentEvents: events,
    recentPrs,
    recentIssues,
    topContributors: memory.activeContributors.slice(0, 5).map((c) => ({
      login: c.login,
      name: c.name,
      commitCount: c.commitCount,
      lastCommitAt: c.lastCommitAt,
    })),
    hotFiles: memory.frequentlyChangedFiles.slice(0, 5).map((f) => ({
      path: f.path,
      changes: f.changes,
    })),
  };
}
