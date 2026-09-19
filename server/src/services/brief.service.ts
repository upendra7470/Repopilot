import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { commitFiles, commits } from "../db/schema.js";
import { getRepositoryById } from "./repository.service.js";
import { getRecentActivity } from "./memory.service.js";
import { analyzeRepositoryRisks } from "./risk.service.js";
import { listPullRequests } from "./pr-intelligence.service.js";
import { listIssues } from "./issue-intelligence.service.js";
import {
  FAILURE_CONCLUSIONS,
  getCiSummary,
  listRuns,
} from "./ci-intelligence.service.js";
import { detectIncidents } from "./incident-intelligence.service.js";
import { getLogger } from "../utils/logger.js";

/**
 * Deterministic Engineering Brief composition (Phase 13).
 *
 * A single bounded read composing EXISTING intelligence — no duplicated
 * detection logic, no new scoring models. The brief is computed on every
 * read and never persisted; only optional AI enhancements are cached.
 * Every claim references evidence built here; sections distinguish
 * time-windowed activity from current-state snapshots explicitly.
 */

export const BRIEF_WINDOWS = {
  recent: 3,
  "7": 7,
  "30": 30,
} as const;

export type BriefWindowLabel = keyof typeof BRIEF_WINDOWS;

export interface BriefWindow {
  label: BriefWindowLabel;
  days: number;
  /** Inclusive lower bound; activity at/after this instant is in-window. */
  since: Date;
}

export function parseBriefWindow(raw: unknown): BriefWindow | null {
  const label = (typeof raw === "string" ? raw : "recent") as string;
  if (!(label in BRIEF_WINDOWS)) {
    return null;
  }
  const key = label as BriefWindowLabel;
  const days = BRIEF_WINDOWS[key];
  return { label: key, days, since: new Date(Date.now() - days * 86_400_000) };
}

export type BriefEvidenceKind =
  | "commit"
  | "pr"
  | "issue"
  | "run"
  | "incident"
  | "risk"
  | "file"
  | "workflow"
  | "contributor";

export interface BriefEvidenceItem {
  id: string;
  kind: BriefEvidenceKind;
  label: string;
  detail: string;
  entityType: string;
  entityId: string;
}

export interface BriefSectionItem {
  title: string;
  description: string;
  severity: string | null;
  entityType: string;
  entityId: string;
  evidenceIds: string[];
}

export interface BriefRelationship {
  description: string;
  /** Ordered entity hops; every hop resolves to a real record or link. */
  path: Array<{ entityType: string; entityId: string; label: string }>;
  evidenceIds: string[];
}

export interface EngineeringBrief {
  repository: {
    id: string;
    fullName: string;
    owner: string;
    name: string;
    defaultBranch: string;
  };
  generatedAt: Date;
  window: { label: string; days: number; since: Date };
  /** Deterministic factual sentences — no business impact, no causality. */
  summary: string[];
  counts: {
    commits: number;
    contributors: number;
    filesChanged: number;
    prsOpened: number;
    prsMerged: number;
    issuesOpened: number;
    issuesClosed: number;
    ciFailures: number;
    ciRecoveries: number;
  };
  /** Time-windowed: commits with file/change context. */
  whatChanged: BriefSectionItem[];
  /** Time-windowed: failed runs, streaks, unstable workflows, PR CI states. */
  failures: BriefSectionItem[];
  /** Time-windowed by burst/recovery time; status is current-state. */
  incidents: BriefSectionItem[];
  /** Current-state snapshot from the Risk Engine (labeled as such). */
  risks: BriefSectionItem[];
  /** Current-state open PRs + windowed PR activity. */
  pullRequests: BriefSectionItem[];
  /** Current-state open issues + windowed issue activity. */
  issues: BriefSectionItem[];
  relationships: BriefRelationship[];
  unknowns: string[];
  investigationNextSteps: BriefSectionItem[];
  evidence: BriefEvidenceItem[];
}

const CAP = {
  activityCommits: 100,
  files: 15,
  prs: 10,
  issues: 10,
  runs: 50,
  risks: 8,
  incidents: 8,
  relationships: 12,
  steps: 8,
  evidencePerClaim: 10,
} as const;

function inWindow(at: Date | null, since: Date): boolean {
  return at !== null && !Number.isNaN(at.getTime()) && at.getTime() >= since.getTime();
}

function shortSha(sha: string | null): string {
  return sha && sha.length >= 7 ? sha.slice(0, 7) : "unknown";
}

export function fingerprintBriefEvidence(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Canonical evidence id for an incident evidence ref. Incident refs carry
 * full commit SHAs while the brief uses 12-character commit ids — one
 * commit must never appear under two evidence ids.
 */
function canonicalRefId(kind: string, value: string): string {
  if (kind === "commit" && value.length > 12) {
    return `commit:${value.slice(0, 12)}`;
  }
  return `${kind}:${value}`;
}

export async function getEngineeringBrief(
  repositoryId: string,
  window: BriefWindow,
): Promise<EngineeringBrief | null> {
  const logger = getLogger();
  const db = getDb();
  const repo = await getRepositoryById(repositoryId);
  if (!repo) {
    return null;
  }
  const { since } = window;

  const [activity, prs, openIssues, closedIssues, ci, allIncidents, riskReport] =
    await Promise.all([
      getRecentActivity(repositoryId, CAP.activityCommits),
      listPullRequests(repositoryId, "all"),
      listIssues(repositoryId, { state: "open", perPage: 50 }),
      listIssues(repositoryId, { state: "closed", perPage: 50 }),
      getCiSummary(repositoryId),
      detectIncidents(repositoryId),
      analyzeRepositoryRisks(repositoryId),
    ]);

  // ---- evidence index (deduplicated by canonical id) ----
  const evidenceById = new Map<string, BriefEvidenceItem>();
  const addEvidence = (item: BriefEvidenceItem): string => {
    if (!evidenceById.has(item.id)) {
      evidenceById.set(item.id, item);
    }
    return item.id;
  };
  const commitEvidenceId = (sha: string): string => `commit:${sha.slice(0, 12)}`;
  // Structural invariant: every file id referenced by any claim must
  // resolve in the evidence index. The top-N window-files loop above is a
  // display cap, not a reference bound — call this at each reference site.
  const ensureFileEvidence = (path: string): void => {
    if (evidenceById.has(`file:${path}`)) {
      return;
    }
    const changes = windowFiles.get(path);
    addEvidence({
      id: `file:${path}`,
      kind: "file",
      label: path,
      detail:
        changes !== undefined
          ? `changed in ${changes} window commit${changes === 1 ? "" : "s"}`
          : "referenced by brief claims; see linked sections",
      entityType: "file",
      entityId: path,
    });
  };

  // ---- windowed commits + files + contributors ----
  const windowCommits = activity.filter(
    (c): c is typeof c & { sha: string } => inWindow(c.at, since) && c.sha !== null,
  );
  const windowShas: string[] = [...new Set(windowCommits.map((c) => c.sha))];
  const filesBySha = new Map<string, string[]>();
  if (windowShas.length > 0) {
    const rows = await db
      .select({ sha: commits.sha, path: commitFiles.path })
      .from(commitFiles)
      .innerJoin(commits, eq(commitFiles.commitId, commits.id))
      .where(
        and(
          eq(commitFiles.repositoryId, repositoryId),
          inArray(commits.sha, windowShas),
        ),
      );
    for (const row of rows) {
      const list = filesBySha.get(row.sha) ?? [];
      if (!list.includes(row.path)) {
        list.push(row.path);
      }
      filesBySha.set(row.sha, list);
    }
  }
  const windowFiles = new Map<string, number>();
  for (const paths of filesBySha.values()) {
    for (const path of paths) {
      windowFiles.set(path, (windowFiles.get(path) ?? 0) + 1);
    }
  }
  const contributorCounts = new Map<string, number>();
  for (const commit of windowCommits) {
    if (commit.authorLogin) {
      contributorCounts.set(commit.authorLogin, (contributorCounts.get(commit.authorLogin) ?? 0) + 1);
    }
  }
  for (const sha of windowShas) {
    const commit = windowCommits.find((c) => c.sha === sha);
    addEvidence({
      id: commitEvidenceId(sha),
      kind: "commit",
      label: `${shortSha(sha)} ${(commit?.title ?? "").slice(0, 120)}`,
      detail: `by ${commit?.authorLogin ?? "unknown"}`,
      entityType: "commit",
      entityId: sha,
    });
  }
  for (const [path, changes] of [...windowFiles.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, CAP.files)) {
    addEvidence({
      id: `file:${path}`,
      kind: "file",
      label: path,
      detail: `changed in ${changes} window commit${changes === 1 ? "" : "s"}`,
      entityType: "file",
      entityId: path,
    });
  }
  for (const [login] of [...contributorCounts.entries()].sort((a, b) => b[1] - a[1])) {
    addEvidence({
      id: `contributor:${login}`,
      kind: "contributor",
      label: login,
      detail: `${contributorCounts.get(login)} window commit(s)`,
      entityType: "contributor",
      entityId: login,
    });
  }

  const whatChanged: BriefSectionItem[] = windowCommits.slice(0, 10).map((commit) => {
    const sha = commit.sha as string;
    const paths = filesBySha.get(sha) ?? [];
    const ids = [commitEvidenceId(sha)];
    for (const path of paths.slice(0, 5)) {
      ensureFileEvidence(path);
      ids.push(`file:${path}`);
    }
    return {
      title: `${shortSha(sha)} ${commit.title}`,
      description:
        paths.length > 0
          ? `Changed ${paths.length} file${paths.length === 1 ? "" : "s"}${commit.authorLogin ? ` · by ${commit.authorLogin}` : ""}.`
          : `No changed-file records for this commit${commit.authorLogin ? ` · by ${commit.authorLogin}` : ""}.`,
      severity: null,
      entityType: "commit",
      entityId: sha,
      evidenceIds: ids.slice(0, CAP.evidencePerClaim),
    };
  });

  // ---- PRs: windowed activity + current open snapshot ----
  const prsInWindow = prs.filter((p) => inWindow(p.githubUpdatedAt, since));
  const openPrs = prs.filter((p) => p.state === "open");
  for (const pr of [...prsInWindow, ...openPrs].slice(0, CAP.prs * 2)) {
    addEvidence({
      id: `pr:${pr.number}`,
      kind: "pr",
      label: `PR #${pr.number} ${pr.title ?? ""}`.trim(),
      detail: `State ${pr.state}${pr.merged ? " (merged)" : ""} · by ${pr.authorLogin ?? "unknown"}`,
      entityType: "pr",
      entityId: String(pr.number),
    });
  }
  // ---- Issues: windowed activity + current open snapshot ----
  const issuesInWindow = [...openIssues.data, ...closedIssues.data].filter((i) =>
    inWindow(i.githubUpdatedAt, since),
  );
  for (const issue of [...issuesInWindow, ...openIssues.data].slice(0, CAP.issues * 2)) {
    addEvidence({
      id: `issue:${issue.number}`,
      kind: "issue",
      label: `Issue #${issue.number} ${issue.title ?? ""}`.trim(),
      detail: `State ${issue.state} · by ${issue.authorLogin ?? "unknown"}`,
      entityType: "issue",
      entityId: String(issue.number),
    });
  }

  // ---- CI: windowed runs + snapshot streaks/states ----
  const runsPage = await listRuns(repositoryId, { page: 1, perPage: CAP.runs });
  const runsByGithubId = new Map(runsPage.data.map((r) => [r.githubId, r]));
  // NOTE: CiSummary.failureStreaks[].lastRunGithubId carries the internal
  // run row id (not the GitHub run id) by existing convention — resolve
  // streak recency through it without redefining upstream semantics.
  const runsByRowId = new Map(runsPage.data.map((r) => [r.id, r]));
  const failedInWindow = runsPage.data.filter(
    (r) =>
      inWindow(r.githubCreatedAt, since) &&
      r.status === "completed" &&
      r.conclusion !== null &&
      FAILURE_CONCLUSIONS.has(r.conclusion),
  );
  for (const run of [...failedInWindow, ...ci.recentFailures].slice(0, 20)) {
    addEvidence({
      id: `run:${run.githubId}`,
      kind: "run",
      label: `${run.workflowName ?? "Workflow"} #${run.runNumber ?? run.githubId} ${run.conclusion ?? run.status ?? ""}`.trim(),
      detail: `Branch ${run.headBranch ?? "?"} · commit ${shortSha(run.headSha)}`,
      entityType: "run",
      entityId: run.githubId,
    });
  }
  for (const streak of ci.failureStreaks.slice(0, 5)) {
    addEvidence({
      id: `workflow:${streak.workflowGithubId}`,
      kind: "workflow",
      label: streak.workflowName ?? streak.workflowGithubId,
      detail: `${streak.streak} consecutive failures (snapshot intelligence)`,
      entityType: "workflow",
      entityId: streak.workflowGithubId,
    });
  }

  const failures: BriefSectionItem[] = [];
  // Windowed streaks only: a streak counts when its latest failure is in-window.
  for (const streak of ci.failureStreaks.slice(0, 5)) {
    const latest = runsByGithubId.get(streak.lastRunGithubId) ?? runsByRowId.get(streak.lastRunGithubId);
    if (!latest || !inWindow(latest.githubCreatedAt, since)) {
      continue;
    }
    failures.push({
      title: `${streak.workflowName ?? "Workflow"}: ${streak.streak} consecutive failures`,
      description: `Latest failure in window · branch ${latest.headBranch ?? "?"}. Inspect the run, not a diagnosis.`,
      severity: streak.streak >= 5 ? "high" : "medium",
      entityType: "workflow",
      entityId: streak.workflowGithubId,
      evidenceIds: [`workflow:${streak.workflowGithubId}`, `run:${latest.githubId}`].slice(0, CAP.evidencePerClaim),
    });
  }
  for (const run of failedInWindow.slice(0, 8)) {
    failures.push({
      title: `Failed: ${run.workflowName ?? "Workflow"} #${run.runNumber ?? run.githubId}`,
      description: `Conclusion ${run.conclusion ?? "?"} on branch ${run.headBranch ?? "?"} · commit ${shortSha(run.headSha)}.`,
      severity: "medium",
      entityType: "run",
      entityId: run.githubId,
      evidenceIds: [`run:${run.githubId}`],
    });
  }
  for (const unstable of ci.unstableWorkflows.slice(0, 3)) {
    failures.push({
      title: `${unstable.workflowName ?? "Workflow"} unstable (${unstable.failures}/${unstable.window})`,
      description: "Repeated success/failure oscillation (snapshot intelligence).",
      severity: "medium",
      entityType: "workflow",
      entityId: unstable.workflowGithubId,
      evidenceIds: [`workflow:${unstable.workflowGithubId}`],
    });
  }
  for (const prState of ci.prCiStates.filter((p) => p.state === "failed").slice(0, 5)) {
    failures.push({
      title: `PR #${prState.prNumber} has failing CI`,
      description: prState.prTitle ?? "Associated run failed.",
      severity: "medium",
      entityType: "pr",
      entityId: String(prState.prNumber),
      evidenceIds: [
        `pr:${prState.prNumber}`,
        ...(prState.runGithubId ? [`run:${prState.runGithubId}`] : []),
      ].slice(0, CAP.evidencePerClaim),
    });
  }

  // ---- Incidents in window (by burst or recovery time) ----
  const incidents = allIncidents
    .filter(
      (incident) =>
        inWindow(incident.burstEndAt, since) || inWindow(incident.recoveryAt, since),
    )
    .slice(0, CAP.incidents);
  for (const incident of incidents) {
    addEvidence({
      id: `incident:${incident.fingerprint}`,
      kind: "incident",
      label: incident.title,
      detail: `Status ${incident.status} · severity ${incident.severity}`,
      entityType: "incident",
      entityId: incident.fingerprint,
    });
    for (const ref of incident.evidence.slice(0, 20)) {
      // Normalize to brief canonical ids (see canonicalRefId).
      const id = canonicalRefId(ref.kind, ref.value);
      if (!evidenceById.has(id)) {
        addEvidence({
          id,
          kind: ref.kind as BriefEvidenceKind,
          label: ref.label,
          detail: `Incident evidence (${incident.fingerprint.slice(0, 8)}…)`,
          entityType: ref.kind,
          entityId: ref.value,
        });
      }
    }
  }
  const incidentItems: BriefSectionItem[] = incidents.map((incident) => ({
    title: incident.title,
    description: incident.summary,
    severity: incident.severity,
    entityType: "incident",
    entityId: incident.fingerprint,
    evidenceIds: [`incident:${incident.fingerprint}`],
  }));

  // ---- Risks: current-state snapshot, top severity ----
  const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const topRisks = [...riskReport.findings]
    .sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9))
    .slice(0, CAP.risks);
  for (const finding of topRisks) {
    addEvidence({
      id: `risk:${finding.id}`,
      kind: "risk",
      label: `${finding.severity}: ${finding.title}`,
      detail: finding.summary,
      entityType: "risk",
      entityId: finding.id,
    });
    for (const path of finding.affectedFiles.slice(0, 5)) {
      ensureFileEvidence(path);
    }
  }
  const riskItems: BriefSectionItem[] = topRisks.map((finding) => ({
    title: finding.title,
    description: `${finding.summary} (current snapshot, not windowed).`,
    severity: finding.severity,
    entityType: "risk",
    entityId: finding.id,
    evidenceIds: [
      `risk:${finding.id}`,
      ...finding.affectedFiles.slice(0, 3).map((p) => `file:${p}`),
    ].slice(0, CAP.evidencePerClaim),
  }));

  // ---- PR / issue attention ----
  const prItems: BriefSectionItem[] = [
    ...prsInWindow.slice(0, CAP.prs).map((pr) => ({
      title: `PR #${pr.number} ${pr.title ?? ""}`.trim(),
      description: `Updated in window · state ${pr.state}${pr.merged ? " (merged)" : ""} · by ${pr.authorLogin ?? "unknown"}.`,
      severity: null as string | null,
      entityType: "pr",
      entityId: String(pr.number),
      evidenceIds: [`pr:${pr.number}`],
    })),
    ...openPrs
      .filter((pr) => !prsInWindow.some((w) => w.number === pr.number))
      .slice(0, 3)
      .map((pr) => ({
        title: `PR #${pr.number} ${pr.title ?? ""}`.trim(),
        description: `Currently open (snapshot) · last activity outside the window.`,
        severity: null as string | null,
        entityType: "pr",
        entityId: String(pr.number),
        evidenceIds: [`pr:${pr.number}`],
      })),
  ].slice(0, CAP.prs);
  for (const pr of openPrs.slice(0, CAP.prs)) {
    if (!evidenceById.has(`pr:${pr.number}`)) {
      addEvidence({
        id: `pr:${pr.number}`,
        kind: "pr",
        label: `PR #${pr.number} ${pr.title ?? ""}`.trim(),
        detail: `State ${pr.state}${pr.merged ? " (merged)" : ""}`,
        entityType: "pr",
        entityId: String(pr.number),
      });
    }
  }

  const issueItems: BriefSectionItem[] = [
    ...issuesInWindow.slice(0, CAP.issues).map((issue) => ({
      title: `Issue #${issue.number} ${issue.title ?? ""}`.trim(),
      description: `Updated in window · state ${issue.state} · by ${issue.authorLogin ?? "unknown"}.`,
      severity: null as string | null,
      entityType: "issue",
      entityId: String(issue.number),
      evidenceIds: [`issue:${issue.number}`],
    })),
    ...openIssues.data
      .filter((issue) => !issuesInWindow.some((w) => w.number === issue.number))
      .slice(0, 3)
      .map((issue) => ({
        title: `Issue #${issue.number} ${issue.title ?? ""}`.trim(),
        description: `Currently open (snapshot) · ${issue.dimensions.commentCount} comments.`,
        severity: null as string | null,
        entityType: "issue",
        entityId: String(issue.number),
        evidenceIds: [`issue:${issue.number}`],
      })),
  ].slice(0, CAP.issues);

  // ---- Relationships: incident chains + run→commit→file chains + risk→file ----
  const relationships: BriefRelationship[] = [];
  const pushRelationship = (
    description: string,
    path: BriefRelationship["path"],
    evidenceIds: string[],
  ): void => {
    if (relationships.length >= CAP.relationships) {
      return;
    }
    relationships.push({ description, path, evidenceIds: evidenceIds.slice(0, CAP.evidencePerClaim) });
  };
  for (const incident of incidents.slice(0, 4)) {
    const path: BriefRelationship["path"] = [
      { entityType: "incident", entityId: incident.fingerprint, label: incident.title },
    ];
    const evidenceIds = [`incident:${incident.fingerprint}`];
    for (const ref of incident.evidence) {
      const id = canonicalRefId(ref.kind, ref.value);
      if (["run", "commit", "file", "pr", "issue", "risk"].includes(ref.kind)) {
        if (path.length < 7) {
          path.push({ entityType: ref.kind, entityId: ref.value, label: ref.label });
        }
        evidenceIds.push(id);
      }
      if (path.length >= 7) {
        break;
      }
    }
    pushRelationship(
      `Incident reconstruction: ${incident.title} (association only, not causation).`,
      path,
      evidenceIds,
    );
  }
  for (const run of failedInWindow.slice(0, 4)) {
    if (!run.headSha) {
      continue;
    }
    const paths = filesBySha.get(run.headSha) ?? [];
    // Only link files observed in the window commit map; otherwise the
    // run→file hop would mix window and snapshot semantics silently.
    if (paths.length === 0) {
      continue;
    }
    for (const path of paths.slice(0, 3)) {
      ensureFileEvidence(path);
    }
    pushRelationship(
      `Failed run associated with commit ${shortSha(run.headSha)} and its changed files.`,
      [
        { entityType: "run", entityId: run.githubId, label: `Run #${run.runNumber ?? run.githubId}` },
        { entityType: "commit", entityId: run.headSha, label: shortSha(run.headSha) },
        ...paths.slice(0, 3).map((path) => ({ entityType: "file", entityId: path, label: path })),
      ],
      [`run:${run.githubId}`, commitEvidenceId(run.headSha), ...paths.slice(0, 3).map((p) => `file:${p}`)],
    );
  }
  for (const finding of topRisks.slice(0, 4)) {
    if (finding.affectedFiles.length === 0) {
      continue;
    }
    pushRelationship(
      `Risk overlap: ${finding.title} touches files changed in this repository.`,
      [
        { entityType: "risk", entityId: finding.id, label: finding.title },
        ...finding.affectedFiles.slice(0, 3).map((path) => ({ entityType: "file", entityId: path, label: path })),
      ],
      [`risk:${finding.id}`, ...finding.affectedFiles.slice(0, 3).map((p) => `file:${p}`)],
    );
  }

  // ---- Unknowns (conditional + fixed) ----
  const unknowns: string[] = [];
  if (windowCommits.length === 0) {
    unknowns.push(`No commits were synchronized in the last ${window.days} days — change activity for this window is unknown, not zero by assumption.`);
  }
  if (runsPage.data.filter((r) => inWindow(r.githubCreatedAt, since)).length === 0) {
    unknowns.push("No CI runs in this window — CI status for the period is unknown from available repository evidence.");
  }
  if (incidents.length === 0) {
    unknowns.push("No incident candidates detected in this window.");
  }
  if (prsInWindow.length === 0 && openPrs.length === 0) {
    unknowns.push("No pull request data available.");
  }
  if (issuesInWindow.length === 0 && openIssues.pagination.total === 0) {
    unknowns.push("No issue data available.");
  }
  unknowns.push(
    "Production impact is unknown — no production telemetry is available.",
    "Root cause is not established — temporal correlation is not causation.",
    "CI logs are unavailable — failure reasons beyond conclusions cannot be determined.",
    "Deployment state is unknown — no deployment data is available.",
    "Activity outside the selected window is excluded by design.",
  );

  // ---- Investigation next steps (evidence-derived only) ----
  const investigationNextSteps: BriefSectionItem[] = [];
  const pushStep = (title: string, description: string, evidenceIds: string[]): void => {
    if (investigationNextSteps.length >= CAP.steps || evidenceIds.length === 0) {
      return;
    }
    investigationNextSteps.push({
      title,
      description,
      severity: null,
      entityType: "step",
      entityId: `${investigationNextSteps.length}`,
      evidenceIds: evidenceIds.slice(0, CAP.evidencePerClaim),
    });
  };
  for (const incident of incidents.filter((i) => i.status === "active").slice(0, 2)) {
    pushStep(
      `Inspect active incident: ${incident.title}`,
      "Walk the evidence chain — runs, commit, files, linked PR/issue — before concluding anything.",
      [`incident:${incident.fingerprint}`],
    );
  }
  for (const streak of ci.failureStreaks.slice(0, 2)) {
    const latest = runsByGithubId.get(streak.lastRunGithubId) ?? runsByRowId.get(streak.lastRunGithubId);
    if (latest && inWindow(latest.githubCreatedAt, since)) {
      pushStep(
        `Inspect failing workflow ${streak.workflowName ?? streak.workflowGithubId}`,
        `${streak.streak} consecutive failures — start from the latest failed run.`,
        [`workflow:${streak.workflowGithubId}`, `run:${latest.githubId}`],
      );
    }
  }
  for (const finding of topRisks.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 2)) {
    pushStep(
      `Review ${finding.severity} risk: ${finding.title}`,
      finding.recommendation || "Inspect the affected files and their history.",
      [`risk:${finding.id}`],
    );
  }
  for (const failed of ci.prCiStates.filter((p) => p.state === "failed").slice(0, 2)) {
    pushStep(
      `Review PR #${failed.prNumber} with failing CI`,
      failed.prTitle ?? "Associated run failed — inspect before merging.",
      [`pr:${failed.prNumber}`, ...(failed.runGithubId ? [`run:${failed.runGithubId}`] : [])],
    );
  }

  // ---- Executive summary (deterministic templates only) ----
  const summary: string[] = [];
  summary.push(
    `${windowCommits.length} commit${windowCommits.length === 1 ? "" : "s"} from ${contributorCounts.size} contributor${contributorCounts.size === 1 ? "" : "s"} changed ${windowFiles.size} file${windowFiles.size === 1 ? "" : "s"} in the last ${window.days} days.`,
  );
  summary.push(
    `${prsInWindow.length} pull request${prsInWindow.length === 1 ? "" : "s"} updated (${openPrs.length} currently open); ${issuesInWindow.length} issue${issuesInWindow.length === 1 ? "" : "s"} updated (${openIssues.pagination.total} currently open).`,
  );
  const windowFailedCount = failedInWindow.length;
  if (windowFailedCount > 0) {
    summary.push(
      `${windowFailedCount} CI failure${windowFailedCount === 1 ? "" : "s"} in the window${incidents.length > 0 ? ` across ${incidents.length} incident candidate${incidents.length === 1 ? "" : "s"}` : ""}.`,
    );
  } else {
    summary.push("No CI failures observed in the window.");
  }
  if (topRisks.length > 0) {
    const critical = topRisks.filter((f) => f.severity === "critical").length;
    const high = topRisks.filter((f) => f.severity === "high").length;
    summary.push(
      `${topRisks.length} current risk finding${topRisks.length === 1 ? "" : "s"} surfaced${critical + high > 0 ? ` (${critical} critical, ${high} high)` : ""} — snapshot state, not windowed.`,
    );
  } else {
    summary.push("No current risk findings surfaced.");
  }

  // Backstop invariant: every id referenced by any claim or relationship
  // path must resolve in the evidence index. Individual builders call
  // ensureFileEvidence at each reference site; this sweep guards against
  // future sites forgetting to do so (files only — all other kinds are
  // added unconditionally where their records are loaded).
  const referencedIds = new Set<string>();
  for (const section of [
    whatChanged,
    failures,
    incidentItems,
    riskItems,
    prItems,
    issueItems,
    investigationNextSteps,
  ]) {
    for (const item of section) {
      for (const id of item.evidenceIds) {
        referencedIds.add(id);
      }
    }
  }
  for (const rel of relationships) {
    for (const id of rel.evidenceIds) {
      referencedIds.add(id);
    }
  }
  for (const id of referencedIds) {
    if (!evidenceById.has(id) && id.startsWith("file:")) {
      ensureFileEvidence(id.slice("file:".length));
    }
  }

  const evidence = [...evidenceById.values()].sort((a, b) => (a.id < b.id ? -1 : 1));

  logger.debug(
    {
      repositoryId,
      window: window.label,
      commits: windowCommits.length,
      evidence: evidence.length,
      relationships: relationships.length,
    },
    "Engineering brief composed",
  );

  return {
    repository: {
      id: repo.id,
      fullName: repo.fullName,
      owner: repo.owner,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
    },
    generatedAt: new Date(),
    window: { label: window.label, days: window.days, since },
    summary,
    counts: {
      commits: windowCommits.length,
      contributors: contributorCounts.size,
      filesChanged: windowFiles.size,
      prsOpened: prs.filter((p) => p.githubCreatedAt && inWindow(p.githubCreatedAt, since)).length,
      prsMerged: prs.filter((p) => p.merged && p.mergedAt && inWindow(p.mergedAt, since)).length,
      issuesOpened: [...openIssues.data, ...closedIssues.data].filter((i) =>
        inWindow(i.githubCreatedAt, since),
      ).length,
      issuesClosed: closedIssues.data.filter((i) => inWindow(i.closedAt, since)).length,
      ciFailures: windowFailedCount,
      ciRecoveries: ci.recovered.length,
    },
    whatChanged,
    failures,
    incidents: incidentItems,
    risks: riskItems,
    pullRequests: prItems,
    issues: issueItems,
    relationships,
    unknowns,
    investigationNextSteps,
    evidence,
  };
}
