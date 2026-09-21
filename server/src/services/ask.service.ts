import { getRepositoryById } from "./repository.service.js";
import {
  computeIssueIntelligence,
  getIssue,
  listIssues,
} from "./issue-intelligence.service.js";
import {
  computePrIntelligence,
  getPullRequest,
  listPullRequests,
} from "./pr-intelligence.service.js";
import {
  getCiSummary,
  getRunDetail,
} from "./ci-intelligence.service.js";
import {
  detectIncidents,
  getIncident,
} from "./incident-intelligence.service.js";
import {
  analyzeRepositoryRisks,
} from "./risk.service.js";
import {
  getContributorActivity,
  getContributorSummaries,
  getEngineeringTimeline,
  getFileHistory,
  getFrequentlyChangedFiles,
  getRecentActivity,
  listRepositoryFiles,
  searchMemory,
} from "./memory.service.js";
import { getEngineeringBrief } from "./brief.service.js";
import { getLogger } from "../utils/logger.js";

/**
 * Deterministic Ask RepoPilot retrieval (Phase 15).
 *
 * Questions are classified by a bounded rule-based intent layer, entities
 * are resolved against synced records, and evidence is retrieved through
 * existing intelligence services — never invented. The LLM (see
 * ask-analysis.service.ts) only ever explains the package built here.
 */

export const ASK_LIMITS = {
  /** Hard cap on evidence items per answer. */
  maxEvidenceItems: 60,
  /** Detail text per evidence item, in characters. */
  maxDetailChars: 500,
  /** Conversation turns accepted for follow-up context. */
  maxHistoryTurns: 3,
  /** Question length bounds. */
  minQuestionChars: 3,
  maxQuestionChars: 500,
  /** Entity candidates examined per kind before resolving. */
  maxEntityCandidates: 20,
} as const;

export type AskIntent =
  | "overview"
  | "recent_changes"
  | "risks"
  | "pull_requests"
  | "issues"
  | "ci_cd"
  | "incidents"
  | "files"
  | "contributors"
  | "relationships"
  | "timeline"
  | "engineering_brief"
  | "cross_domain_investigation"
  | "unknown";

export type AskEntityKind =
  | "pr"
  | "issue"
  | "commit"
  | "incident"
  | "run"
  | "file"
  | "workflow"
  | "contributor"
  | "risk";

export interface AskEntityRef {
  kind: AskEntityKind;
  value: string;
  label: string;
  /** Set when several records match and none was silently picked. */
  ambiguous?: boolean;
  /** True when the reference could not be matched to a synced record. */
  unresolved?: boolean;
}

export interface AskEvidenceItem {
  id: string;
  kind: string;
  label: string;
  detail: string;
  entityType: string;
  entityId: string;
  at: string | null;
}

export interface AskWindow {
  label: string;
  days: number;
  since: Date;
}

export interface AskConversationTurn {
  question: string;
  evidenceIds: string[];
}

export interface AskFinding {
  text: string;
  evidenceIds: string[];
}

export interface AskResult {
  question: string;
  intent: AskIntent;
  entities: AskEntityRef[];
  window: AskWindow | null;
  answer: string;
  keyFindings: AskFinding[];
  evidence: AskEvidenceItem[];
  unknowns: string[];
  investigationNextSteps: AskFinding[];
  relatedEntities: AskEntityRef[];
  metadata: {
    retrievalMs: number;
    evidenceCount: number;
    truncated: boolean;
  };
}

const DOMAIN_PATTERNS: Record<string, RegExp[]> = {
  brief: [/\bbrief\b/, /\bstatus report\b/, /\btldr\b/, /\bsummary of (the )?(repo|repository)\b/],
  incident: [/\bincident\b/, /\boutage\b/, /\bdowntime\b/, /\bdisruption\b/, /\bburst\b/],
  ci: [/\bci\b/, /\bci\/cd\b/, /\bpipeline\b/, /\bworkflow\b/, /\bbuild\b/, /\btest failure\b/, /\bfailing (test|build|check|ci)\b/, /\bunstable\b/, /\bflak/i],
  risk: [/\brisk\b/, /\brisky\b/, /\bhot ?file\b/, /\bchurn\b/, /\bdanger/],
  pr: [/\bprs?\b/, /\bpull request\b/, /\bmerge\b/, /\breview\b/],
  issue: [/\bissues?\b/, /\bbug\b/, /\bticket\b/],
  file: [/\bfile\b/, /\bdirectory\b/, /\bpath\b/, /\bcode in\b/, /\bwhere is\b/, /\bwho touched\b/],
  contributor: [/\bwho\b/, /\bcontributor\b/, /\bauthor\b/, /\bteam\b/, /\bworked on\b/],
  relationship: [/\bconnect\b/, /\brelated\b/, /\brelationship\b/, /\blink between\b/, /\bassociated with\b/, /\boverlap\b/],
  timeline: [/\btimeline\b/, /\bhistory\b/, /\bbefore\b/, /\bafter\b/, /\bwhen did\b/, /\bchronolog/, /\bsequence\b/],
  change: [/\brecent\b/, /\blatest\b/, /\bthis week\b/, /\bchanged\b/, /\bnewest\b/, /\bactivity\b/],
  overview: [/\boverview\b/, /\bhappening\b/, /\bstate of\b/, /\bhealth of\b/, /\bgoing on\b/],
};

const INTENT_BY_DOMAIN: Record<string, AskIntent> = {
  brief: "engineering_brief",
  incident: "incidents",
  ci: "ci_cd",
  risk: "risks",
  pr: "pull_requests",
  issue: "issues",
  file: "files",
  contributor: "contributors",
  relationship: "relationships",
  timeline: "timeline",
  change: "recent_changes",
  overview: "overview",
};

// Ordered before generic domain matching: specific beats general.
const INTENT_PRIORITY: AskIntent[] = [
  "engineering_brief",
  "incidents",
  "ci_cd",
  "risks",
  "pull_requests",
  "issues",
  "files",
  "contributors",
  "relationships",
  "timeline",
  "recent_changes",
  "overview",
];

/**
 * Deterministic rule-based classification. Returns the first matching
 * intent in priority order; cross-domain when ≥2 distinct domain groups
 * fire; unknown when nothing fires.
 */
export function classifyIntent(question: string): AskIntent {
  const text = question.toLowerCase();
  const hits = new Set<string>();
  for (const [domain, patterns] of Object.entries(DOMAIN_PATTERNS)) {
    if (patterns.some((re) => re.test(text))) {
      hits.add(domain);
    }
  }
  if (hits.size === 0) {
    return "unknown";
  }
  const groups = new Set(
    [...hits].map((d) =>
      d === "brief" || d === "overview" || d === "change" || d === "timeline"
        ? "general"
        : d,
    ),
  );
  if (groups.size >= 2 && groups.has("incident")) {
    return "cross_domain_investigation";
  }
  if (
    groups.size >= 2 &&
    (hits.has("relationship") ||
      (hits.has("ci") && (hits.has("risk") || hits.has("file"))) ||
      (hits.has("pr") && hits.has("issue") && (hits.has("ci") || hits.has("risk"))))
  ) {
    return "cross_domain_investigation";
  }
  for (const intent of INTENT_PRIORITY) {
    const domain = Object.entries(INTENT_BY_DOMAIN).find(([, v]) => v === intent)?.[0];
    if (domain && hits.has(domain)) {
      return intent;
    }
  }
  return "unknown";
}

export function parseAskWindow(question: string): AskWindow | null {
  const text = question.toLowerCase();
  const now = Date.now();
  const day = 86_400_000;
  const startOfUtcDay = (t: number): number => {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  if (/\btoday\b/.test(text)) {
    return { label: "today", days: 1, since: new Date(startOfUtcDay(now)) };
  }
  if (/\byesterday\b/.test(text)) {
    return { label: "yesterday", days: 1, since: new Date(startOfUtcDay(now) - day) };
  }
  const lastN = text.match(/\blast (\d+) days?\b/);
  if (lastN) {
    const days = Math.min(Math.max(parseInt(lastN[1], 10), 1), 90);
    return { label: `last ${days} days`, days, since: new Date(now - days * day) };
  }
  if (/\bthis week\b/.test(text)) {
    return { label: "this week", days: 7, since: new Date(now - 7 * day) };
  }
  if (/\blast 30 days\b|\bmonth\b/.test(text)) {
    return { label: "30 days", days: 30, since: new Date(now - 30 * day) };
  }
  if (/\blast (7|seven) days\b|\blast week\b/.test(text)) {
    return { label: "7 days", days: 7, since: new Date(now - 7 * day) };
  }
  if (/\brecent\b|\blatest\b/.test(text)) {
    return { label: "recent", days: 3, since: new Date(now - 3 * day) };
  }
  return null;
}

function truncateDetail(value: string | null, max: number = ASK_LIMITS.maxDetailChars): string {
  if (!value) {
    return "";
  }
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function iso(at: Date | string | null): string | null {
  if (!at) {
    return null;
  }
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Deterministic entity resolution against synced records. References that
 * match nothing are returned unresolved (never dropped silently); ambiguous
 * short SHAs are flagged, never auto-picked.
 */
export async function resolveEntities(
  repositoryId: string,
  question: string,
  historyEvidenceIds: string[] = [],
  context?: { entityType: string; entityId: string } | null,
): Promise<AskEntityRef[]> {
  const text = question;
  const entities: AskEntityRef[] = [];
  const seen = new Set<string>();
  const push = (entity: AskEntityRef): void => {
    const key = `${entity.kind}:${entity.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      entities.push(entity);
    }
  };

  // Contextual entity from Knowledge Graph (explicitly provided, not from question text)
  if (context?.entityType && context?.entityId) {
    const kindMap: Record<string, AskEntityKind> = {
      commit: "commit",
      file: "file",
      contributor: "contributor",
      pull_request: "pr",
      issue: "issue",
      ci_workflow: "workflow",
      ci_run: "run",
      risk: "risk",
      incident: "incident",
    };
    const kind = kindMap[context.entityType] ?? "file";
    push({
      kind,
      value: context.entityId,
      label: `${context.entityType}:${context.entityId}`,
    });
  }

  // Explicit PR / issue numbers.
  for (const match of text.matchAll(/(?:\bpr\b|pull request|issue)[\s#]*(\d{1,6})/gi)) {
    const isPr = /pr|pull/i.test(match[0]);
    const number = parseInt(match[1], 10);
    if (isPr) {
      const pr = await getPullRequest(repositoryId, number);
      push(
        pr
          ? { kind: "pr", value: String(number), label: `PR #${number} ${pr.title ?? ""}`.trim() }
          : { kind: "pr", value: String(number), label: `PR #${number}`, unresolved: true },
      );
    } else {
      const issue = await getIssue(repositoryId, number);
      push(
        issue
          ? { kind: "issue", value: String(number), label: `Issue #${number} ${issue.title ?? ""}`.trim() }
          : { kind: "issue", value: String(number), label: `Issue #${number}`, unresolved: true },
      );
    }
    if (entities.length >= ASK_LIMITS.maxEntityCandidates) {
      break;
    }
  }

  // Full commit SHAs.
  for (const match of text.matchAll(/\b[0-9a-f]{40}\b/gi)) {
    push({ kind: "commit", value: match[0].toLowerCase(), label: `Commit ${match[0].slice(0, 7)}` });
  }

  // Short SHAs: prefix-match recent commits; ambiguous unless unique.
  for (const match of text.matchAll(/\b[0-9a-f]{7,39}\b/gi)) {
    const prefix = match[0].toLowerCase();
    if (prefix.length >= 40) {
      continue; // handled above
    }
    // Skip tokens that are part of longer words already handled as numbers.
    const recent = await getRecentActivity(repositoryId, 100);
    const hits = recent.filter((c) => c.sha?.toLowerCase().startsWith(prefix));
    if (hits.length === 1 && hits[0].sha) {
      push({ kind: "commit", value: hits[0].sha.toLowerCase(), label: `Commit ${hits[0].sha.slice(0, 7)}` });
    } else if (hits.length > 1) {
      push({
        kind: "commit",
        value: prefix,
        label: `Commit ${prefix}…`,
        ambiguous: true,
      });
    }
    if (entities.length >= ASK_LIMITS.maxEntityCandidates) {
      break;
    }
  }

  // Incident fingerprints.
  for (const match of text.matchAll(/\b[0-9a-f]{64}\b/gi)) {
    const incident = await getIncident(repositoryId, match[0].toLowerCase());
    push(
      incident
        ? { kind: "incident", value: incident.fingerprint, label: incident.title }
        : { kind: "incident", value: match[0].toLowerCase(), label: "Incident", unresolved: true },
    );
  }

  // CI run references ("run 123", "run #123", "CI run 123").
  for (const match of text.matchAll(/\brun[\s#]*(\d{1,10})\b/gi)) {
    const runId = match[1];
    const detail = await getRunDetail(repositoryId, runId);
    push(
      detail
        ? {
          kind: "run",
          value: runId,
          label: `${detail.workflow?.name ?? "Workflow"} #${detail.run.runNumber ?? runId}`,
        }
        : { kind: "run", value: runId, label: `Run ${runId}`, unresolved: true },
    );
  }

  // File paths: tokens that look like paths, verified against synced files.
  for (const match of text.matchAll(/(?:^|[\s("'])([\w.-][\w./-]*\.\w{1,10})/g)) {
    const candidate = match[1];
    const found = await searchMemory(repositoryId, candidate);
    const exact = found.files.find((f) => f.path === candidate || f.path.endsWith(`/${candidate}`));
    if (exact) {
      push({ kind: "file", value: exact.path, label: exact.path });
    }
    if (entities.length >= ASK_LIMITS.maxEntityCandidates) {
      break;
    }
  }

  // "Latest incident" / "latest failure" shorthands.
  if (/\blatest incident\b/i.test(text)) {
    const incidents = await detectIncidents(repositoryId);
    if (incidents[0]) {
      push({ kind: "incident", value: incidents[0].fingerprint, label: incidents[0].title });
    }
  }
  if (/\blatest failure\b|\bmost recent failure\b/i.test(text)) {
    const summary = await getCiSummary(repositoryId);
    const latest = summary.recentFailures[0];
    if (latest) {
      push({
        kind: "run",
        value: latest.githubId,
        label: `${latest.workflowName ?? "Workflow"} #${latest.runNumber ?? latest.githubId}`,
      });
    }
  }

  // "Failing workflow" shorthand.
  if (/\bfailing workflow\b/i.test(text)) {
    const summary = await getCiSummary(repositoryId);
    const streak = summary.failureStreaks[0];
    if (streak) {
      push({
        kind: "workflow",
        value: streak.workflowGithubId,
        label: streak.workflowName ?? streak.workflowGithubId,
      });
    }
  }

  // Pronoun follow-ups ("that", "it", "those changes") resolve against the
  // previous turn's validated evidence ids — newest first.
  if (/\b(that|it|those|these|this (pr|issue|incident|run|file|commit))\b/i.test(text)) {
    const prId = [...historyEvidenceIds].reverse().find((id) => id.startsWith("pr:"));
    const issueId = [...historyEvidenceIds].reverse().find((id) => id.startsWith("issue:"));
    const incidentId = [...historyEvidenceIds].reverse().find((id) => id.startsWith("incident:"));
    const runId = [...historyEvidenceIds].reverse().find((id) => id.startsWith("run:"));
    const fileId = [...historyEvidenceIds].reverse().find((id) => id.startsWith("file:"));
    const wantsPr = /\bpr\b|pull request/i.test(text);
    const wantsIssue = /\bissue\b/i.test(text);
    const wantsIncident = /\bincident\b/i.test(text);
    const wantsRun = /\brun\b|\bfailure\b/i.test(text);
    const wantsFile = /\bfile\b|\bchange\b/i.test(text);
    if (wantsPr && prId) {
      push({ kind: "pr", value: prId.slice(3), label: `PR #${prId.slice(3)}` });
    } else if (wantsIssue && issueId) {
      push({ kind: "issue", value: issueId.slice(6), label: `Issue #${issueId.slice(6)}` });
    } else if (wantsIncident && incidentId) {
      push({ kind: "incident", value: incidentId.slice(9), label: "Incident" });
    } else if (wantsRun && runId) {
      push({ kind: "run", value: runId.slice(4), label: `Run ${runId.slice(4)}` });
    } else if (wantsFile && fileId) {
      push({ kind: "file", value: fileId.slice(5), label: fileId.slice(5) });
    } else {
      const fallback = [...historyEvidenceIds].reverse()[0];
      if (fallback) {
        const [kind, ...rest] = fallback.split(":");
        if (["pr", "issue", "incident", "run", "file", "commit"].includes(kind)) {
          push({ kind: kind as AskEntityKind, value: rest.join(":"), label: fallback });
        }
      }
    }
  }

  return entities;
}

export interface RetrievalInput {
  intent: AskIntent;
  entities: AskEntityRef[];
  window: AskWindow | null;
}

export interface RetrievedEvidence {
  evidence: AskEvidenceItem[];
  truncated: boolean;
  retrievalMs: number;
}

function makeEvidence(
  id: string,
  kind: string,
  label: string,
  detail: string,
  entityType: string,
  entityId: string,
  at: Date | string | null = null,
): AskEvidenceItem {
  return {
    id,
    kind,
    label,
    detail: truncateDetail(detail),
    entityType,
    entityId,
    at: iso(at),
  };
}

/**
 * Bounded deterministic retrieval composing existing intelligence
 * services. Every item traces to a synced record; the total is capped at
 * ASK_LIMITS.maxEvidenceItems with oldest-domain-priority preserved by
 * insertion order (callers add most-relevant evidence first).
 */
export async function retrieveEvidence(
  repositoryId: string,
  input: RetrievalInput,
): Promise<RetrievedEvidence> {
  const started = Date.now();
  const logger = getLogger();
  const evidence: AskEvidenceItem[] = [];
  const seen = new Set<string>();
  let truncated = false;
  const push = (item: AskEvidenceItem): void => {
    if (seen.has(item.id) || evidence.length >= ASK_LIMITS.maxEvidenceItems) {
      if (!seen.has(item.id)) {
        truncated = true;
      }
      return;
    }
    seen.add(item.id);
    evidence.push(item);
  };

  const resolvedPrs = input.entities.filter((e) => e.kind === "pr" && !e.unresolved && !e.ambiguous);
  const resolvedIssues = input.entities.filter((e) => e.kind === "issue" && !e.unresolved && !e.ambiguous);
  const resolvedRuns = input.entities.filter((e) => e.kind === "run" && !e.unresolved && !e.ambiguous);
  const resolvedIncidents = input.entities.filter((e) => e.kind === "incident" && !e.unresolved && !e.ambiguous);
  const resolvedCommits = input.entities.filter((e) => e.kind === "commit" && !e.unresolved && !e.ambiguous);
  const resolvedFiles = input.entities.filter((e) => e.kind === "file" && !e.unresolved && !e.ambiguous);

  // Resolved entities first — direct references outrank everything. Explicit
  // references are never window-filtered: the user asked about them directly.
  for (const ref of resolvedPrs.slice(0, 5)) {
    const pr = await getPullRequest(repositoryId, parseInt(ref.value, 10));
    if (!pr) {
      continue;
    }
    push(makeEvidence(
      `pr:${pr.number}`, "pr", `PR #${pr.number} ${pr.title ?? ""}`.trim(),
      `State ${pr.state}${pr.merged ? " (merged)" : ""} · by ${pr.authorLogin ?? "unknown"}`,
      "pr", String(pr.number), pr.githubUpdatedAt,
    ));
    const intel = await computePrIntelligence(repositoryId, pr.number);
    if (intel) {
      for (const file of intel.files.slice(0, 10)) {
        push(makeEvidence(
          `file:${file.path}`, "file", file.path,
          `${file.status ?? "changed"}${file.additions !== null ? ` +${file.additions}/-${file.deletions ?? 0}` : ""}`,
          "file", file.path,
        ));
      }
      for (const commit of intel.commits.slice(0, 10)) {
        push(makeEvidence(
          `commit:${commit.sha.slice(0, 12)}`, "commit",
          `${commit.sha.slice(0, 7)} ${(commit.message ?? "").split("\n")[0]}`,
          `by ${commit.authorLogin ?? "unknown"}`, "commit", commit.sha, commit.committedAt,
        ));
      }
      for (const risk of intel.riskFindings.slice(0, 5)) {
        push(makeEvidence(
          `risk:${risk.id}`, "risk", `${risk.severity}: ${risk.title}`,
          `Risk type ${risk.type}`, "risk", risk.id,
        ));
      }
    }
  }

  for (const ref of resolvedIssues.slice(0, 5)) {
    const intel = await computeIssueIntelligence(repositoryId, parseInt(ref.value, 10));
    if (!intel) {
      continue;
    }
    for (const pr of intel.linkedPrs.slice(0, 5)) {
      push(makeEvidence(
        `pr:${pr.number}`, "pr", `PR #${pr.number} ${pr.title ?? ""}`.trim(),
        `${pr.relation}; state ${pr.state}${pr.merged ? " (merged)" : ""}`, "pr", String(pr.number),
      ));
    }
    for (const commit of intel.linkedCommits.slice(0, 10)) {
      push(makeEvidence(
        `commit:${commit.sha.slice(0, 12)}`, "commit",
        `${commit.sha.slice(0, 7)} ${(commit.message ?? "").split("\n")[0]}`,
        `by ${commit.authorLogin ?? "unknown"}`, "commit", commit.sha, commit.committedAt,
      ));
    }
    for (const file of intel.files.slice(0, 10)) {
      push(makeEvidence(
        `file:${file.path}`, "file", file.path,
        `${file.windowChanges} recent changes${file.hot ? "; historically hot" : ""}`,
        "file", file.path,
      ));
    }
    for (const risk of intel.riskFindings.slice(0, 5)) {
      push(makeEvidence(
        `risk:${risk.id}`, "risk", `${risk.severity}: ${risk.title}`,
        `Risk type ${risk.type}`, "risk", risk.id,
      ));
    }
    for (const comment of intel.recentComments.slice(0, 5)) {
      push(makeEvidence(
        `comment:${comment.githubId}`, "issue_comment",
        `Comment by ${comment.authorLogin ?? "unknown"}`,
        truncateDetail(comment.body, 300), "issue", ref.value, comment.githubCreatedAt,
      ));
    }
  }

  for (const ref of resolvedRuns.slice(0, 5)) {
    const detail = await getRunDetail(repositoryId, ref.value);
    if (!detail) {
      continue;
    }
    push(makeEvidence(
      `run:${detail.run.githubId}`, "run",
      `${detail.workflow?.name ?? "Workflow"} #${detail.run.runNumber ?? detail.run.githubId}`,
      `Status ${detail.run.status ?? "?"} · conclusion ${detail.run.conclusion ?? "unknown"} · branch ${detail.run.headBranch ?? "?"}`,
      "run", detail.run.githubId, detail.run.githubCreatedAt,
    ));
    if (detail.commit) {
      push(makeEvidence(
        `commit:${detail.commit.sha.slice(0, 12)}`, "commit",
        `${detail.commit.sha.slice(0, 7)} ${(detail.commit.message ?? "").split("\n")[0]}`,
        `by ${detail.commit.authorLogin ?? "unknown"}`, "commit", detail.commit.sha,
      ));
    }
    for (const file of detail.files.slice(0, 10)) {
      push(makeEvidence(
        `file:${file.path}`, "file", file.path,
        `${file.windowChanges} recent changes${file.hot ? "; historically hot" : ""}`,
        "file", file.path,
      ));
    }
    for (const pr of detail.linkedPrs.slice(0, 5)) {
      push(makeEvidence(
        `pr:${pr.number}`, "pr", `PR #${pr.number} ${pr.title ?? ""}`.trim(),
        `Linked via ${pr.via}; state ${pr.state}`, "pr", String(pr.number),
      ));
    }
    for (const issue of detail.relatedIssues.slice(0, 5)) {
      push(makeEvidence(
        `issue:${issue.number}`, "issue", `Issue #${issue.number} ${issue.title ?? ""}`.trim(),
        `State ${issue.state}`, "issue", String(issue.number),
      ));
    }
    for (const risk of detail.riskFindings.slice(0, 5)) {
      push(makeEvidence(
        `risk:${risk.id}`, "risk", `${risk.severity}: ${risk.title}`,
        `Risk type ${risk.type}`, "risk", risk.id,
      ));
    }
  }

  for (const ref of resolvedIncidents.slice(0, 3)) {
    const incident = await getIncident(repositoryId, ref.value);
    if (!incident) {
      continue;
    }
    push(makeEvidence(
      `incident:${incident.fingerprint}`, "incident", incident.title, incident.summary,
      "incident", incident.fingerprint, incident.burstEndAt,
    ));
    for (const entry of incident.timeline.slice(0, 15)) {
      const id = `${entry.ref.kind}:${entry.ref.value}`;
      push(makeEvidence(
        id, entry.ref.kind, entry.title,
        entry.detail ?? "", entry.ref.kind, entry.ref.value, entry.at,
      ));
    }
    for (const file of incident.filePaths.slice(0, 10)) {
      push(makeEvidence(
        `file:${file}`, "file", file, "Changed in a burst commit; association only, not cause",
        "file", file,
      ));
    }
    for (const n of incident.linkedPrNumbers.slice(0, 5)) {
      push(makeEvidence(
        `pr:${n}`, "pr", `PR #${n}`, "Linked to the incident through CI evidence",
        "pr", String(n),
      ));
    }
    for (const n of incident.linkedIssueNumbers.slice(0, 5)) {
      push(makeEvidence(
        `issue:${n}`, "issue", `Issue #${n}`, "Linked to the incident through CI evidence",
        "issue", String(n),
      ));
    }
    for (const id of incident.riskFindingIds.slice(0, 5)) {
      push(makeEvidence(
        `risk:${id}`, "risk", id, "Overlaps incident files",
        "risk", id,
      ));
    }
  }

  for (const ref of resolvedCommits.slice(0, 5)) {
    const recent = await getRecentActivity(repositoryId, 100);
    const match = recent.find((c) => c.sha?.toLowerCase() === ref.value.toLowerCase());
    if (match?.sha) {
      push(makeEvidence(
        `commit:${match.sha.slice(0, 12)}`, "commit",
        `${match.sha.slice(0, 7)} ${match.title}`,
        `by ${match.authorLogin ?? "unknown"}`, "commit", match.sha, match.at,
      ));
    }
  }

  for (const ref of resolvedFiles.slice(0, 5)) {
    const history = await getFileHistoryByPath(repositoryId, ref.value);
    if (history) {
      push(makeEvidence(
        `file:${history.file.path}`, "file", history.file.path,
        `${history.changeCount} recorded changes; latest by ${history.latestChange?.authorLogin ?? "unknown"}`,
        "file", history.file.path, history.latestChange?.committedAt ?? null,
      ));
      for (const entry of history.history.slice(0, 5)) {
        if (!entry.sha) {
          continue;
        }
        push(makeEvidence(
          `commit:${entry.sha.slice(0, 12)}`, "commit",
          `${entry.sha.slice(0, 7)} ${(entry.message ?? "").split("\n")[0]}`,
          `by ${entry.authorLogin ?? "unknown"}`, "commit", entry.sha, entry.committedAt,
        ));
      }
      for (const contributor of history.contributors.slice(0, 5)) {
        push(makeEvidence(
          `contributor:${contributor.login}`, "contributor", contributor.login,
          `${contributor.changes} changes to this file`, "contributor", contributor.login,
        ));
      }
    }
  }

  // Intent-driven retrieval (bounded, most relevant first).
  const intent = input.intent;
  if (intent === "overview" || intent === "recent_changes" || intent === "timeline" || intent === "cross_domain_investigation" || intent === "unknown") {
    const activity = await getRecentActivity(repositoryId, 30);
    for (const event of activity) {
      if (!inWindowEvent(event.at, input) || !event.sha) {
        continue;
      }
      push(makeEvidence(
        `commit:${event.sha.slice(0, 12)}`, "commit",
        `${event.sha.slice(0, 7)} ${event.title}`,
        `by ${event.authorLogin ?? "unknown"}`, "commit", event.sha, event.at,
      ));
      if (evidence.length >= ASK_LIMITS.maxEvidenceItems) {
        break;
      }
    }
  }
  if (intent === "overview" || intent === "risks" || intent === "cross_domain_investigation" || intent === "unknown") {
    const report = await analyzeRepositoryRisks(repositoryId);
    for (const finding of report.findings.slice(0, 8)) {
      push(makeEvidence(
        `risk:${finding.id}`, "risk", `${finding.severity}: ${finding.title}`,
        finding.summary, "risk", finding.id,
      ));
      for (const path of finding.affectedFiles.slice(0, 3)) {
        push(makeEvidence(
          `file:${path}`, "file", path, `Affected by ${finding.severity} risk`,
          "file", path,
        ));
      }
    }
  }
  if (intent === "overview" || intent === "pull_requests" || intent === "cross_domain_investigation" || intent === "unknown") {
    const prs = await listPullRequests(repositoryId, "open");
    for (const pr of prs.slice(0, 10)) {
      push(makeEvidence(
        `pr:${pr.number}`, "pr", `PR #${pr.number} ${pr.title ?? ""}`.trim(),
        `State ${pr.state}${pr.merged ? " (merged)" : ""} · by ${pr.authorLogin ?? "unknown"}`,
        "pr", String(pr.number), pr.githubUpdatedAt,
      ));
    }
  }
  if (intent === "overview" || intent === "issues" || intent === "cross_domain_investigation" || intent === "unknown") {
    const page = await listIssues(repositoryId, { state: "open", perPage: 10 });
    for (const issue of page.data) {
      push(makeEvidence(
        `issue:${issue.number}`, "issue", `Issue #${issue.number} ${issue.title ?? ""}`.trim(),
        `State ${issue.state} · ${issue.commentsCount} comments · by ${issue.authorLogin ?? "unknown"}`,
        "issue", String(issue.number), issue.githubUpdatedAt,
      ));
    }
  }
  if (intent === "overview" || intent === "ci_cd" || intent === "incidents" || intent === "cross_domain_investigation" || intent === "timeline" || intent === "unknown") {
    const summary = await getCiSummary(repositoryId);
    for (const failure of summary.recentFailures.slice(0, 8)) {
      push(makeEvidence(
        `run:${failure.githubId}`, "run",
        `${failure.workflowName ?? "Workflow"} #${failure.runNumber ?? failure.githubId}`,
        `Conclusion ${failure.conclusion ?? "?"} on ${failure.headBranch ?? "?"} · commit ${(failure.headSha ?? "?").slice(0, 7)}`,
        "run", failure.githubId, failure.githubCreatedAt,
      ));
    }
    for (const streak of summary.failureStreaks.slice(0, 3)) {
      push(makeEvidence(
        `workflow:${streak.workflowGithubId}`, "workflow",
        streak.workflowName ?? streak.workflowGithubId,
        `${streak.streak} consecutive failures`, "workflow", streak.workflowGithubId,
      ));
    }
    for (const state of summary.prCiStates.filter((p) => p.state === "failed").slice(0, 5)) {
      push(makeEvidence(
        `pr:${state.prNumber}`, "pr", `PR #${state.prNumber} ${state.prTitle ?? ""}`.trim(),
        `Failing CI (${state.conclusion ?? "unknown"})`, "pr", String(state.prNumber),
      ));
    }
    const incidents = await detectIncidents(repositoryId);
    for (const incident of incidents.slice(0, 5)) {
      push(makeEvidence(
        `incident:${incident.fingerprint}`, "incident", incident.title, incident.summary,
        "incident", incident.fingerprint, incident.burstEndAt,
      ));
    }
  }
  if (intent === "contributors" || intent === "overview" || intent === "unknown") {
    const summaries = await getContributorSummaries(repositoryId);
    for (const contributor of summaries.slice(0, 10)) {
      push(makeEvidence(
        `contributor:${contributor.login}`, "contributor", contributor.login,
        `${contributor.commitCount} commits${contributor.lastCommitAt ? ` · last active ${contributor.lastCommitAt.toISOString().slice(0, 10)}` : ""}`,
        "contributor", contributor.login,
      ));
    }
  }
  if (intent === "files" || intent === "relationships" || intent === "cross_domain_investigation") {
    const files = await getFrequentlyChangedFiles(repositoryId, 10);
    for (const file of files) {
      push(makeEvidence(
        `file:${file.path}`, "file", file.path,
        `${file.changes} recorded changes`,
        "file", file.path,
      ));
    }
  }
  if (intent === "timeline") {
    const timeline = await getEngineeringTimeline(repositoryId, 30);
    for (const item of timeline) {
      const id =
        item.kind === "commit" ? `commit:${item.ref.value.slice(0, 12)}`
        : item.kind === "pr" ? `pr:${item.ref.value}`
        : item.kind === "issue" ? `issue:${item.ref.value}`
        : item.kind === "ci_run" ? `run:${item.ref.value}`
        : `incident:${item.ref.value}`;
      push(makeEvidence(
        id, item.kind === "ci_run" ? "run" : item.kind, item.title,
        item.subtitle ?? "",
        item.ref.entity, item.ref.value, item.at,
      ));
    }
  }
  // Resolved contributor entities get their recorded activity summary.
  const resolvedContributors = input.entities.filter(
    (e) => e.kind === "contributor" && !e.unresolved && !e.ambiguous,
  );
  if (resolvedContributors.length > 0) {
    const summaries = await getContributorSummaries(repositoryId);
    for (const ref of resolvedContributors.slice(0, 5)) {
      const summary = summaries.find(
        (s) => s.login.toLowerCase() === ref.value.toLowerCase(),
      );
      if (!summary) {
        continue;
      }
      const activity = await getContributorActivity(repositoryId, summary.id);
      if (!activity) {
        continue;
      }
      push(makeEvidence(
        `contributor:${summary.login}`, "contributor", summary.login,
        `${activity.commitCount} commits · ${activity.filesTouched} files touched` +
        `${activity.lastCommitAt ? ` · last active ${activity.lastCommitAt.toISOString().slice(0, 10)}` : ""}`,
        "contributor", summary.login, activity.lastCommitAt,
      ));
    }
  }
  if (intent === "engineering_brief") {
    const brief = await getEngineeringBrief(repositoryId, { label: "recent", days: 3, since: new Date(Date.now() - 3 * 86_400_000) });
    if (brief) {
      for (const item of brief.evidence.slice(0, 30)) {
        push(makeEvidence(
          item.id, item.kind, item.label, item.detail,
          item.entityType, item.entityId,
        ));
      }
    }
  }
  if (intent === "relationships" || intent === "cross_domain_investigation") {
    // Cross-domain chains: incident → runs → commits → files → PRs →
    // issues → risks, assembled from already-retrieved evidence links.
    await attachRelationshipChains(repositoryId, evidence, push);
  }

  logger.debug(
    { repositoryId, intent, evidence: evidence.length, truncated },
    "Ask retrieval completed",
  );
  return {
    evidence,
    truncated,
    retrievalMs: Date.now() - started,
  };
}

function inWindowEvent(at: Date | null, input: RetrievalInput): boolean {
  if (!input.window || !at || Number.isNaN(at.getTime())) {
    return true;
  }
  return at.getTime() >= input.window.since.getTime();
}

/** Resolve a file path to its history record (null when not synced). */
async function getFileHistoryByPath(repositoryId: string, path: string) {
  const files = await listRepositoryFiles(repositoryId, { prefix: path, limit: 20 });
  const exact = files.find((f) => f.path === path) ?? files.find((f) => f.path.endsWith(`/${path}`));
  if (!exact) {
    return null;
  }
  return getFileHistory(repositoryId, exact.id);
}

/**
 * Append cross-domain relationship chains derived from evidence already
 * retrieved: incident → run → commit → file → PR → issue → risk.
 * Only hops backed by a retrieved record are added; nothing is inferred.
 */
async function attachRelationshipChains(
  repositoryId: string,
  evidence: AskEvidenceItem[],
  push: (item: AskEvidenceItem) => void,
): Promise<void> {
  const logger = getLogger();
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const incidents = evidence.filter((e) => e.kind === "incident");
  for (const incident of incidents.slice(0, 3)) {
    const full = await getIncident(repositoryId, incident.entityId);
    if (!full) {
      continue;
    }
    for (const n of full.linkedPrNumbers.slice(0, 3)) {
      const id = `pr:${n}`;
      if (byId.has(id)) {
        continue;
      }
      const pr = await getPullRequest(repositoryId, n);
      if (pr) {
        push(makeEvidence(
          id, "pr", `PR #${n} ${pr.title ?? ""}`.trim(),
          `State ${pr.state}${pr.merged ? " (merged)" : ""} · linked to incident evidence`,
          "pr", String(n), pr.githubUpdatedAt,
        ));
      }
    }
    for (const n of full.linkedIssueNumbers.slice(0, 3)) {
      const id = `issue:${n}`;
      if (byId.has(id)) {
        continue;
      }
      const issue = await getIssue(repositoryId, n);
      if (issue) {
        push(makeEvidence(
          id, "issue", `Issue #${n} ${issue.title ?? ""}`.trim(),
          `State ${issue.state} · linked to incident evidence`,
          "issue", String(n), issue.githubUpdatedAt,
        ));
      }
    }
    // Commits behind burst files: resolve through file history (bounded).
    for (const path of full.filePaths.slice(0, 3)) {
      const history = await getFileHistoryByPath(repositoryId, path);
      for (const entry of (history?.history ?? []).slice(0, 3)) {
        if (!entry.sha) {
          continue;
        }
        const id = `commit:${entry.sha.slice(0, 12)}`;
        if (byId.has(id)) {
          continue;
        }
        push(makeEvidence(
          id, "commit", `${entry.sha.slice(0, 7)} ${(entry.message ?? "").split("\n")[0]}`,
          `Touched ${path}; reached through incident file evidence`, "commit", entry.sha, entry.committedAt,
        ));
      }
    }
  }
  logger.debug({ repositoryId }, "Ask relationship chains attached");
}

export interface RetrievalInput {
  intent: AskIntent;
  entities: AskEntityRef[];
  window: AskWindow | null;
}

export interface AskConversationTurn {
  question: string;
  evidenceIds: string[];
}

export interface AskFinding {
  text: string;
  evidenceIds: string[];
}

export interface AskResult {
  question: string;
  intent: AskIntent;
  entities: AskEntityRef[];
  window: AskWindow | null;
  answer: string;
  assessment: string;
  keyFindings: AskFinding[];
  evidence: AskEvidenceItem[];
  unknowns: string[];
  investigationNextSteps: AskFinding[];
  relatedEntities: AskEntityRef[];
  metadata: {
    retrievalMs: number;
    evidenceCount: number;
    truncated: boolean;
  };
}

const STANDARD_UNKNOWNS = [
  "Production impact is unknown — no production telemetry is available.",
  "Root cause is not established — temporal correlation is not causation.",
  "CI logs are unavailable — failure reasons beyond conclusions cannot be determined.",
];

function finding(text: string, evidenceIds: string[]): AskFinding {
  return { text, evidenceIds: evidenceIds.slice(0, 10) };
}

/**
 * Answer a question deterministically from retrieved evidence. The prose
 * is templated from counts and records — no model involved, so nothing
 * can be hallucinated here; the AI layer only re-explains this package.
 */
export async function answerQuestion(
  repositoryId: string,
  question: string,
  history: AskConversationTurn[] = [],
  context?: { entityType: string; entityId: string } | null,
): Promise<AskResult> {
  const started = Date.now();
  const logger = getLogger();
  const repo = await getRepositoryById(repositoryId);
  if (!repo) {
    throw new Error("Repository not found");
  }

  const intent = classifyIntent(question);
  const window = parseAskWindow(question);
  const historyIds = history.flatMap((t) => t.evidenceIds).slice(-30);
  const entities = await resolveEntities(repositoryId, question, historyIds, context);
  const { evidence, truncated } = await retrieveEvidence(repositoryId, {
    intent,
    entities,
    window,
  });

  const byKind = (kind: string): AskEvidenceItem[] => evidence.filter((e) => e.kind === kind);
  const unknowns: string[] = [];
  const keyFindings: AskFinding[] = [];
  const nextSteps: AskFinding[] = [];
  const parts: string[] = [];

  if (evidence.length === 0) {
    unknowns.push(
      "RepoPilot found no relevant evidence in the synchronized data for this question.",
      "Sync the repository to make its history available for investigation.",
      ...STANDARD_UNKNOWNS,
    );
    return {
      question,
      intent,
      entities,
      window,
      answer:
        `RepoPilot could not find relevant evidence for "${truncateDetail(question, 120)}" ` +
        `in ${repo.fullName}. Sync the repository and try a question about its commits, files, PRs, issues, CI runs, risks, or incidents.`,
      assessment: "unknown",
      keyFindings: [],
      evidence,
      unknowns,
      investigationNextSteps: [
        finding("Sync the repository, then ask about recent changes.", []),
      ],
      relatedEntities: entities,
      metadata: { retrievalMs: Date.now() - started, evidenceCount: 0, truncated },
    };
  }

  const commits = byKind("commit");
  const files = byKind("file");
  const prs = byKind("pr");
  const issues = byKind("issue");
  const runs = byKind("run");
  const risks = byKind("risk");
  const incidents = byKind("incident");
  const contributors = byKind("contributor");

  // Deterministic per-intent summary + findings.
  switch (intent) {
    case "overview": {
      parts.push(
        `${repo.fullName}: ${commits.length} recent commit${commits.length === 1 ? "" : "s"} observed, ` +
        `${prs.length} pull request${prs.length === 1 ? "" : "s"}, ${issues.length} issue${issues.length === 1 ? "" : "s"}, ` +
        `${runs.length} CI run${runs.length === 1 ? "" : "s"}, ${risks.length} risk finding${risks.length === 1 ? "" : "s"}, ` +
        `${incidents.length} incident candidate${incidents.length === 1 ? "" : "s"} in the retrieved evidence.`,
      );
      break;
    }
    case "recent_changes":
    case "timeline": {
      parts.push(
        `${commits.length} commit${commits.length === 1 ? "" : "s"} found${window ? ` in ${window.label}` : ""}, ` +
        `touching ${files.length} file${files.length === 1 ? "" : "s"}.`,
      );
      for (const commit of commits.slice(0, 5)) {
        keyFindings.push(finding(`${commit.label}`, [commit.id]));
      }
      break;
    }
    case "risks": {
      parts.push(
        `${risks.length} risk finding${risks.length === 1 ? "" : "s"} retrieved. ` +
        `Each finding below cites the files and history it was computed from.`,
      );
      for (const risk of risks.slice(0, 8)) {
        keyFindings.push(finding(`${risk.label}: ${risk.detail}`, [risk.id]));
      }
      break;
    }
    case "pull_requests": {
      parts.push(
        `${prs.length} pull request${prs.length === 1 ? "" : "s"} retrieved.`,
      );
      for (const pr of prs.slice(0, 8)) {
        keyFindings.push(finding(`${pr.label} — ${pr.detail}`, [pr.id]));
      }
      break;
    }
    case "issues": {
      parts.push(`${issues.length} issue${issues.length === 1 ? "" : "s"} retrieved.`);
      for (const issue of issues.slice(0, 8)) {
        keyFindings.push(finding(`${issue.label} — ${issue.detail}`, [issue.id]));
      }
      break;
    }
    case "ci_cd": {
      const failed = runs.filter((r) => /failure|failed/i.test(`${r.label} ${r.detail}`));
      parts.push(
        `${runs.length} CI run${runs.length === 1 ? "" : "s"} retrieved` +
        (failed.length > 0 ? `, including ${failed.length} recorded failure${failed.length === 1 ? "" : "s"}` : " with no recorded failures") +
        `. Conclusions below come from synced run records.`,
      );
      for (const run of runs.slice(0, 8)) {
        keyFindings.push(finding(`${run.label} — ${run.detail}`, [run.id]));
      }
      break;
    }
    case "incidents": {
      if (incidents.length === 0) {
        parts.push("No incident candidates detected in the synchronized data.");
        unknowns.push("No incident pattern was detected — this means no qualifying burst exists, not that nothing ever failed.");
      } else {
        parts.push(
          `${incidents.length} incident candidate${incidents.length === 1 ? "" : "s"} detected. ` +
          `Each reconstruction below cites its runs, commits, files, and risks.`,
        );
        for (const incident of incidents.slice(0, 5)) {
          keyFindings.push(finding(`${incident.label} — ${incident.detail}`, [incident.id]));
        }
      }
      break;
    }
    case "files": {
      parts.push(
        `${files.length} file${files.length === 1 ? "" : "s"} retrieved with change history.`,
      );
      for (const file of files.slice(0, 8)) {
        keyFindings.push(finding(`${file.label} — ${file.detail}`, [file.id]));
      }
      break;
    }
    case "contributors": {
      parts.push(
        `${contributors.length} contributor${contributors.length === 1 ? "" : "s"} observed in the retrieved evidence. Counts below are observed commit activity, not rankings.`,
      );
      for (const contributor of contributors.slice(0, 8)) {
        keyFindings.push(finding(`${contributor.label} — ${contributor.detail}`, [contributor.id]));
      }
      break;
    }
    case "relationships":
    case "cross_domain_investigation":
    case "engineering_brief": {
      parts.push(
        `Cross-domain evidence assembled: ${incidents.length} incident${incidents.length === 1 ? "" : "s"}, ` +
        `${runs.length} run${runs.length === 1 ? "" : "s"}, ${commits.length} commit${commits.length === 1 ? "" : "s"}, ` +
        `${files.length} file${files.length === 1 ? "" : "s"}, ${prs.length} PR${prs.length === 1 ? "" : "s"}, ` +
        `${issues.length} issue${issues.length === 1 ? "" : "s"}, ${risks.length} risk${risks.length === 1 ? "" : "s"}. ` +
        `Relationships below use temporal association and shared records only — not causation.`,
      );
      for (const incident of incidents.slice(0, 3)) {
        keyFindings.push(finding(`${incident.label} — ${incident.detail}`, [incident.id]));
      }
      for (const risk of risks.slice(0, 3)) {
        keyFindings.push(finding(`${risk.label} — ${risk.detail}`, [risk.id]));
      }
      break;
    }
    default: {
      parts.push(
        `RepoPilot retrieved ${evidence.length} evidence item${evidence.length === 1 ? "" : "s"} ` +
        `related to this question. Review each item's source before concluding anything.`,
      );
      break;
    }
  }

  // Unresolved / ambiguous references are always surfaced, never silent.
  for (const entity of entities.filter((e) => e.unresolved)) {
    unknowns.push(
      `"${entity.label}" did not match any synced ${entity.kind} record in this repository.`,
    );
  }
  for (const entity of entities.filter((e) => e.ambiguous)) {
    unknowns.push(
      `"${entity.label}" matches several records; RepoPilot did not guess which one was meant.`,
    );
  }
  unknowns.push(...STANDARD_UNKNOWNS);

  // Deterministic next steps point at retrieved evidence.
  const firstIncident = incidents[0];
  if (firstIncident) {
    nextSteps.push(finding(`Open ${firstIncident.label} for the full reconstruction.`, [firstIncident.id]));
  }
  const firstFailedRun = runs[0];
  if (firstFailedRun && (intent === "ci_cd" || intent === "cross_domain_investigation" || intent === "incidents" || intent === "unknown")) {
    nextSteps.push(finding(`Inspect ${firstFailedRun.label} and its commit.`, [firstFailedRun.id]));
  }
  const firstRisk = risks[0];
  if (firstRisk && (intent === "risks" || intent === "cross_domain_investigation" || intent === "overview" || intent === "unknown")) {
    nextSteps.push(finding(`Review the files behind ${firstRisk.label}.`, [firstRisk.id]));
  }
  const firstPr = prs[0];
  if (firstPr && (intent === "pull_requests" || intent === "cross_domain_investigation" || intent === "relationships")) {
    nextSteps.push(finding(`Open ${firstPr.label} for its change surface.`, [firstPr.id]));
  }

  logger.debug(
    { repositoryId, intent, evidence: evidence.length },
    "Ask deterministic answer composed",
  );
  return {
    question,
    intent,
    entities,
    window,
    answer: parts.join(" "),
    assessment: "unknown",
    keyFindings,
    evidence,
    unknowns,
    investigationNextSteps: nextSteps,
    relatedEntities: entities,
    metadata: { retrievalMs: Date.now() - started, evidenceCount: evidence.length, truncated },
  };
}
