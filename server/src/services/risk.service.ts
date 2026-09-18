import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { commits, commitFiles, repositories } from "../db/schema.js";
import { getLogger } from "../utils/logger.js";
import { areaOfPath } from "./memory.service.js";

/**
 * Deterministic Risk Engine (Phase 7).
 *
 * Every finding is computed from synced PostgreSQL records with explicit,
 * centralized thresholds below. No randomness, no inference, no scores —
 * severity follows documented rules and every claim carries evidence
 * pointing at real commits, files, and contributors.
 */

export const RISK_THRESHOLDS = {
  /** Analysis window length in days (quantized to UTC day boundaries). */
  windowDays: 30,
  /** Baseline window (days immediately before the analysis window). */
  baselineDays: 21,
  /** Recent slice (days at the end of the window) for velocity. */
  velocityRecentDays: 7,
  /** Hot file: minimum distinct commits touching a file. */
  hotFileMinCommits: 5,
  hotFileHighCommits: 10,
  hotFileCriticalCommits: 20,
  /** Concentration: minimum area change events + share of all events. */
  concentrationMinChanges: 10,
  concentrationMediumShare: 0.25,
  concentrationHighShare: 0.5,
  /** Contributor concentration minimums. */
  contributorMinChanges: 8,
  contributorMinContributors: 2,
  contributorMediumShare: 0.75,
  contributorHighShare: 0.9,
  /** Churn: total added+deleted lines per file in the window. */
  churnMediumLines: 500,
  churnHighLines: 2000,
  /** Velocity burst minimums. */
  velocityMinRecentCommits: 5,
  velocityBurstRatio: 2,
  /** Corrective-activity counts. */
  correctiveMediumCount: 2,
  correctiveHighCount: 5,
  /** Revert counts. */
  revertHighCount: 3,
  /** Hard cap on findings per report. */
  maxFindings: 20,
} as const;

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type RiskType =
  | "change_concentration"
  | "hot_file"
  | "contributor_concentration"
  | "corrective_activity"
  | "change_velocity"
  | "file_churn"
  | "revert_activity";

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const TYPE_ORDER: RiskType[] = [
  "change_concentration",
  "hot_file",
  "contributor_concentration",
  "corrective_activity",
  "change_velocity",
  "file_churn",
  "revert_activity",
];

export interface EvidenceRef {
  kind: "commit" | "file" | "contributor";
  value: string;
}

export interface RiskEvidence {
  label: string;
  value: string;
  ref?: EvidenceRef;
}

export interface RelatedCommit {
  sha: string;
  message: string | null;
  authorLogin: string | null;
  committedAt: Date | null;
}

export interface RiskFinding {
  /** Stable fingerprint: v1:{repoId}:{type}:{subject}:{windowStartDay}. */
  id: string;
  type: RiskType;
  severity: RiskSeverity;
  title: string;
  summary: string;
  detectedAt: Date;
  evidence: RiskEvidence[];
  affectedFiles: string[];
  affectedContributors: string[];
  relatedCommits: RelatedCommit[];
  recommendation: string;
}

export interface RiskReport {
  repository: { id: string; fullName: string };
  generatedAt: Date;
  analysisWindow: { type: "days"; value: number; start: Date; end: Date };
  summary: { total: number; critical: number; high: number; medium: number; low: number };
  findings: RiskFinding[];
}

interface WindowCommit {
  id: string;
  sha: string;
  message: string | null;
  authorLogin: string | null;
  committedAt: Date | null;
}

interface WindowChange {
  path: string;
  status: string | null;
  additions: number | null;
  deletions: number | null;
  commitSha: string;
  commitMessage: string | null;
  authorLogin: string | null;
  committedAt: Date | null;
}

function firstLine(message: string | null): string {
  return (message ?? "").split("\n")[0];
}

const CORRECTIVE_PATTERN =
  /\b(fix|fixes|fixed|fixing|bug|bugfix|hotfix|revert|reverts|reverted|reverting|regression|patch|repair)\b/i;
const REVERT_PATTERN = /\brevert\w*\b/i;

function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function fingerprint(
  repositoryId: string,
  type: RiskType,
  subject: string,
  windowStart: Date,
): string {
  const day = windowStart.toISOString().slice(0, 10);
  const clean = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
  return `v1:${repositoryId}:${type}:${clean}:${day}`;
}

export async function analyzeRepositoryRisks(
  repositoryId: string,
): Promise<RiskReport> {
  const logger = getLogger();
  const db = getDb();
  const T = RISK_THRESHOLDS;

  const repoRows = await db
    .select({ id: repositories.id, fullName: repositories.fullName })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .limit(1);
  const repo = repoRows[0];
  if (!repo) {
    throw new Error("Repository not found");
  }

  // Window quantized to UTC day boundaries so the same database state
  // yields the same report within a day (stable ordering + fingerprints).
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end.getTime() - T.windowDays * 86_400_000);
  const baselineStart = new Date(start.getTime() - T.baselineDays * 86_400_000);

  const commitRows = await db
    .select({
      id: commits.id,
      sha: commits.sha,
      message: commits.message,
      authorLogin: commits.authorLogin,
      committedAt: commits.committedAt,
    })
    .from(commits)
    .where(
      and(
        eq(commits.repositoryId, repositoryId),
        gte(commits.committedAt, start),
        lt(commits.committedAt, end),
      ),
    )
    .orderBy(desc(commits.committedAt));

  const changeRows = await db
    .select({
      path: commitFiles.path,
      status: commitFiles.status,
      additions: commitFiles.additions,
      deletions: commitFiles.deletions,
      commitSha: commits.sha,
      commitMessage: commits.message,
      authorLogin: commits.authorLogin,
      committedAt: commits.committedAt,
    })
    .from(commitFiles)
    .innerJoin(commits, eq(commitFiles.commitId, commits.id))
    .where(
      and(
        eq(commitFiles.repositoryId, repositoryId),
        gte(commits.committedAt, start),
        lt(commits.committedAt, end),
      ),
    );

  const baselineRows = await db
    .select({ n: count() })
    .from(commits)
    .where(
      and(
        eq(commits.repositoryId, repositoryId),
        gte(commits.committedAt, baselineStart),
        lt(commits.committedAt, start),
      ),
    );
  const baselineCount = Number(baselineRows[0]?.n ?? 0);

  logger.debug(
    { repositoryId, commits: commitRows.length, changes: changeRows.length },
    "Risk analysis inputs",
  );

  const findings: RiskFinding[] = [];
  const detectedAt = new Date(end.getTime() - 1);

  findings.push(
    ...detectCorrectiveActivity(repositoryId, commitRows, start, detectedAt),
  );
  findings.push(
    ...detectRevertActivity(repositoryId, commitRows, start, detectedAt),
  );
  findings.push(
    ...detectHotFiles(repositoryId, changeRows, start, detectedAt),
  );
  findings.push(
    ...detectFileChurn(repositoryId, changeRows, start, detectedAt),
  );
  findings.push(
    ...detectChangeConcentration(repositoryId, changeRows, start, detectedAt),
  );
  findings.push(
    ...detectContributorConcentration(repositoryId, changeRows, start, detectedAt),
  );
  findings.push(
    ...detectChangeVelocity(
      repositoryId,
      commitRows,
      baselineCount,
      start,
      end,
      detectedAt,
    ),
  );

  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const capped = findings.slice(0, T.maxFindings);

  const summary = {
    total: capped.length,
    critical: capped.filter((f) => f.severity === "critical").length,
    high: capped.filter((f) => f.severity === "high").length,
    medium: capped.filter((f) => f.severity === "medium").length,
    low: capped.filter((f) => f.severity === "low").length,
  };

  return {
    repository: { id: repo.id, fullName: repo.fullName },
    generatedAt: new Date(),
    analysisWindow: { type: "days", value: T.windowDays, start, end },
    summary,
    findings: capped,
  };
}

function toRelated(commits: WindowCommit[]): RelatedCommit[] {
  return commits.map((c) => ({
    sha: c.sha,
    message: firstLine(c.message) || null,
    authorLogin: c.authorLogin,
    committedAt: c.committedAt,
  }));
}

function detectCorrectiveActivity(
  repositoryId: string,
  windowCommits: WindowCommit[],
  windowStart: Date,
  detectedAt: Date,
): RiskFinding[] {
  const T = RISK_THRESHOLDS;
  const matches = windowCommits.filter((c) =>
    CORRECTIVE_PATTERN.test(firstLine(c.message)),
  );
  if (matches.length === 0) {
    return [];
  }
  const severity: RiskSeverity =
    matches.length >= T.correctiveHighCount
      ? "high"
      : matches.length >= T.correctiveMediumCount
        ? "medium"
        : "low";
  const shown = matches.slice(0, 10);
  return [
    {
      id: fingerprint(repositoryId, "corrective_activity", "window", windowStart),
      type: "corrective_activity",
      severity,
      title: "Recent corrective activity signal",
      summary:
        `${matches.length} recent commit message${matches.length === 1 ? "" : "s"} ` +
        `read as corrective work (fix/bug/revert/patch language). This signals ` +
        `defect-driven churn, not a confirmed defect count.`,
      detectedAt,
      evidence: [
        {
          label: "Corrective-looking commits in window",
          value: String(matches.length),
        },
        ...shown.map((c) => ({
          label: `Commit ${c.sha.slice(0, 7)}`,
          value: `${firstLine(c.message)} — ${c.authorLogin ?? "unknown"}`,
          ref: { kind: "commit" as const, value: c.sha },
        })),
      ],
      affectedFiles: [],
      affectedContributors: [
        ...new Set(
          matches.map((c) => c.authorLogin).filter((l): l is string => !!l),
        ),
      ],
      relatedCommits: toRelated(shown),
      recommendation:
        "Review the listed commits and their affected files to confirm whether they address a common defect area.",
    },
  ];
}

function detectRevertActivity(
  repositoryId: string,
  windowCommits: WindowCommit[],
  windowStart: Date,
  detectedAt: Date,
): RiskFinding[] {
  const T = RISK_THRESHOLDS;
  const matches = windowCommits.filter((c) =>
    REVERT_PATTERN.test(firstLine(c.message)),
  );
  if (matches.length === 0) {
    return [];
  }
  const severity: RiskSeverity =
    matches.length >= T.revertHighCount ? "high" : "medium";
  const shown = matches.slice(0, 10);
  return [
    {
      id: fingerprint(repositoryId, "revert_activity", "window", windowStart),
      type: "revert_activity",
      severity,
      title: "Recent revert activity detected",
      summary:
        `${matches.length} recent commit message${matches.length === 1 ? "" : "s"} ` +
        `declare revert activity. Reverts signal backing out of prior changes; ` +
        `inspect what was reverted and why.`,
      detectedAt,
      evidence: [
        { label: "Revert-declaring commits", value: String(matches.length) },
        ...shown.map((c) => ({
          label: `Commit ${c.sha.slice(0, 7)}`,
          value: `${firstLine(c.message)} — ${c.authorLogin ?? "unknown"}`,
          ref: { kind: "commit" as const, value: c.sha },
        })),
      ],
      affectedFiles: [],
      affectedContributors: [
        ...new Set(
          matches.map((c) => c.authorLogin).filter((l): l is string => !!l),
        ),
      ],
      relatedCommits: toRelated(shown),
      recommendation:
        "Open each revert commit to see which change was backed out, then check the current state of the affected files.",
    },
  ];
}

interface PathStats {
  path: string;
  commitShas: Set<string>;
  contributors: Map<string, number>;
  lines: number;
  lastChanged: Date | null;
  messages: Array<{ sha: string; message: string | null; authorLogin: string | null; committedAt: Date | null }>;
}

function collectPathStats(changes: WindowChange[]): Map<string, PathStats> {
  const byPath = new Map<string, PathStats>();
  for (const change of changes) {
    let stats = byPath.get(change.path);
    if (!stats) {
      stats = {
        path: change.path,
        commitShas: new Set(),
        contributors: new Map(),
        lines: 0,
        lastChanged: null,
        messages: [],
      };
      byPath.set(change.path, stats);
    }
    stats.commitShas.add(change.commitSha);
    const login = change.authorLogin ?? "(unknown)";
    stats.contributors.set(login, (stats.contributors.get(login) ?? 0) + 1);
    stats.lines += (change.additions ?? 0) + (change.deletions ?? 0);
    const at = change.committedAt?.getTime() ?? null;
    if (at !== null && (stats.lastChanged === null || at > stats.lastChanged.getTime())) {
      stats.lastChanged = change.committedAt;
    }
    if (!stats.messages.some((m) => m.sha === change.commitSha)) {
      stats.messages.push({
        sha: change.commitSha,
        message: change.commitMessage,
        authorLogin: change.authorLogin,
        committedAt: change.committedAt,
      });
    }
  }
  return byPath;
}

function detectHotFiles(
  repositoryId: string,
  changes: WindowChange[],
  windowStart: Date,
  detectedAt: Date,
): RiskFinding[] {
  const T = RISK_THRESHOLDS;
  const byPath = collectPathStats(changes);
  const hot = [...byPath.values()]
    .filter((s) => s.commitShas.size >= T.hotFileMinCommits)
    .sort((a, b) => b.commitShas.size - a.commitShas.size || (a.path < b.path ? -1 : 1))
    .slice(0, 10);

  return hot.map((stats) => {
    const n = stats.commitShas.size;
    const severity: RiskSeverity =
      n >= T.hotFileCriticalCommits
        ? "critical"
        : n >= T.hotFileHighCommits
          ? "high"
          : "medium";
    const contributorList = [...stats.contributors.entries()].sort((a, b) => b[1] - a[1]);
    return {
      id: fingerprint(repositoryId, "hot_file", stats.path, windowStart),
      type: "hot_file" as const,
      severity,
      title: `Hot file: ${stats.path}`,
      summary:
        `${stats.path} was modified in ${n} distinct commits in the analysis ` +
        `window — unusually high recent modification activity for a single file.`,
      detectedAt,
      evidence: [
        { label: "Distinct commits touching file", value: String(n) },
        {
          label: "Distinct contributors",
          value: String(stats.contributors.size),
        },
        {
          label: "Last changed",
          value: stats.lastChanged?.toISOString() ?? "unknown",
        },
        ...contributorList.slice(0, 5).map(([login, count]) => ({
          label: `Changes by ${login}`,
          value: String(count),
          ref: { kind: "contributor" as const, value: login },
        })),
      ],
      affectedFiles: [stats.path],
      affectedContributors: contributorList.map(([login]) => login),
      relatedCommits: stats.messages.slice(0, 10).map((m) => ({ ...m })),
      recommendation: `Open the file history for ${stats.path} and review the recent commits for related or repeated fixes.`,
    };
  });
}

function detectFileChurn(
  repositoryId: string,
  changes: WindowChange[],
  windowStart: Date,
  detectedAt: Date,
): RiskFinding[] {
  const T = RISK_THRESHOLDS;
  const byPath = collectPathStats(changes);
  const churned = [...byPath.values()]
    .filter((s) => s.lines >= T.churnMediumLines)
    .sort((a, b) => b.lines - a.lines || (a.path < b.path ? -1 : 1))
    .slice(0, 10);

  return churned.map((stats) => ({
    id: fingerprint(repositoryId, "file_churn", stats.path, windowStart),
    type: "file_churn" as const,
    severity: stats.lines >= T.churnHighLines ? "high" : "medium",
    title: `File churn hotspot: ${stats.path}`,
    summary:
      `${stats.lines.toLocaleString()} added+deleted lines across ` +
      `${stats.commitShas.size} commits in the analysis window. High churn ` +
      `makes review and future change harder to reason about.`,
    detectedAt,
    evidence: [
      { label: "Lines added+deleted", value: stats.lines.toLocaleString() },
      { label: "Distinct commits", value: String(stats.commitShas.size) },
      {
        label: "Distinct contributors",
        value: String(stats.contributors.size),
      },
    ],
    affectedFiles: [stats.path],
    affectedContributors: [...stats.contributors.keys()],
    relatedCommits: stats.messages.slice(0, 10).map((m) => ({ ...m })),
    recommendation: `Inspect the largest recent diffs to ${stats.path} and consider whether the change set should be split or stabilized.`,
  }));
}

function detectChangeConcentration(
  repositoryId: string,
  changes: WindowChange[],
  windowStart: Date,
  detectedAt: Date,
): RiskFinding[] {
  const T = RISK_THRESHOLDS;
  if (changes.length === 0) {
    return [];
  }
  const byArea = new Map<string, { changes: number; commits: Set<string>; contributors: Set<string>; files: Map<string, number> }>();
  for (const change of changes) {
    const area = areaOfPath(change.path);
    let entry = byArea.get(area);
    if (!entry) {
      entry = { changes: 0, commits: new Set(), contributors: new Set(), files: new Map() };
      byArea.set(area, entry);
    }
    entry.changes += 1;
    entry.commits.add(change.commitSha);
    entry.contributors.add(change.authorLogin ?? "(unknown)");
    entry.files.set(change.path, (entry.files.get(change.path) ?? 0) + 1);
  }

  return [...byArea.entries()]
    .filter(
      ([, entry]) =>
        entry.changes >= T.concentrationMinChanges &&
        entry.changes / changes.length >= T.concentrationMediumShare,
    )
    .sort((a, b) => b[1].changes - a[1].changes || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5)
    .map(([area, entry]) => {
      const share = entry.changes / changes.length;
      const topFiles = [...entry.files.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, 3);
      return {
        id: fingerprint(repositoryId, "change_concentration", area, windowStart),
        type: "change_concentration" as const,
        severity: (share >= T.concentrationHighShare ? "high" : "medium") as RiskSeverity,
        title: `Change concentration in ${area}/`,
        summary:
          `${formatShare(share)} of observed file changes in the analysis window ` +
          `land in ${area}/ — recent engineering activity is heavily concentrated here.`,
        detectedAt,
        evidence: [
          { label: "File-change events in area", value: String(entry.changes) },
          { label: "Share of all observed changes", value: formatShare(share) },
          { label: "Distinct commits", value: String(entry.commits.size) },
          { label: "Distinct contributors", value: String(entry.contributors.size) },
          ...topFiles.map(([path, count]) => ({
            label: `Changes in ${path}`,
            value: String(count),
            ref: { kind: "file" as const, value: path },
          })),
        ],
        affectedFiles: topFiles.map(([path]) => path),
        affectedContributors: [...entry.contributors],
        relatedCommits: [],
        recommendation: `Review the timeline for ${area}/ and check whether the concentration reflects one feature, repeated fixes, or scope creep.`,
      };
    });
}

function detectContributorConcentration(
  repositoryId: string,
  changes: WindowChange[],
  windowStart: Date,
  detectedAt: Date,
): RiskFinding[] {
  const T = RISK_THRESHOLDS;
  const byPath = collectPathStats(changes);
  const concentrated = [...byPath.values()]
    .filter((s) => {
      const total = [...s.contributors.values()].reduce((a, b) => a + b, 0);
      const top = Math.max(...s.contributors.values());
      return (
        total >= T.contributorMinChanges &&
        s.contributors.size >= T.contributorMinContributors &&
        top / total >= T.contributorMediumShare
      );
    })
    .sort((a, b) => b.commitShas.size - a.commitShas.size || (a.path < b.path ? -1 : 1))
    .slice(0, 5);

  return concentrated.map((stats) => {
    const entries = [...stats.contributors.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((a, [, n]) => a + n, 0);
    const topShare = entries[0][1] / total;
    return {
      id: fingerprint(repositoryId, "contributor_concentration", stats.path, windowStart),
      type: "contributor_concentration" as const,
      severity: (topShare >= T.contributorHighShare ? "high" : "medium") as RiskSeverity,
      title: `Contributor concentration in ${stats.path}`,
      summary:
        `${entries[0][0]} accounts for ${formatShare(topShare)} of recent changes ` +
        `to ${stats.path} across ${stats.contributors.size} contributors. ` +
        `Context for review load and knowledge spread — not a performance judgment.`,
      detectedAt,
      evidence: [
        { label: "Total observed changes", value: String(total) },
        {
          label: `Share by ${entries[0][0]}`,
          value: formatShare(topShare),
          ref: { kind: "contributor" as const, value: entries[0][0] },
        },
        ...entries.slice(0, 5).map(([login, count]) => ({
          label: `Changes by ${login}`,
          value: String(count),
          ref: { kind: "contributor" as const, value: login },
        })),
      ],
      affectedFiles: [stats.path],
      affectedContributors: entries.map(([login]) => login),
      relatedCommits: stats.messages.slice(0, 10).map((m) => ({ ...m })),
      recommendation: `Have a second engineer review recent changes to ${stats.path} so context is shared.`,
    };
  });
}

function detectChangeVelocity(
  repositoryId: string,
  windowCommits: WindowCommit[],
  baselineCount: number,
  windowStart: Date,
  windowEnd: Date,
  detectedAt: Date,
): RiskFinding[] {
  const T = RISK_THRESHOLDS;
  const recentCutoff = new Date(windowEnd.getTime() - T.velocityRecentDays * 86_400_000);
  const recent = windowCommits.filter(
    (c) => c.committedAt && c.committedAt >= recentCutoff,
  );
  if (recent.length < T.velocityMinRecentCommits) {
    return [];
  }
  const baselineRate = baselineCount / T.baselineDays;
  const recentRate = recent.length / T.velocityRecentDays;
  const ratio = baselineRate > 0 ? recentRate / baselineRate : Number.POSITIVE_INFINITY;
  if (!(ratio > T.velocityBurstRatio)) {
    return [];
  }
  const shown = recent.slice(0, 10);
  return [
    {
      id: fingerprint(repositoryId, "change_velocity", "window", windowStart),
      type: "change_velocity" as const,
      severity: "medium",
      title: "Unusual burst of engineering activity",
      summary:
        `${recent.length} commits in the last ${T.velocityRecentDays} days versus a ` +
        `baseline of about ${baselineRate.toFixed(1)} per day — a burst signal ` +
        `worth a look, not automatically a problem.`,
      detectedAt,
      evidence: [
        { label: `Commits in last ${T.velocityRecentDays} days`, value: String(recent.length) },
        { label: "Baseline commits per day", value: baselineRate.toFixed(2) },
        {
          label: "Burst ratio",
          value: Number.isFinite(ratio) ? `${ratio.toFixed(1)}x` : "new activity",
        },
        ...shown.map((c) => ({
          label: `Commit ${c.sha.slice(0, 7)}`,
          value: `${firstLine(c.message)} — ${c.authorLogin ?? "unknown"}`,
          ref: { kind: "commit" as const, value: c.sha },
        })),
      ],
      affectedFiles: [],
      affectedContributors: [
        ...new Set(recent.map((c) => c.authorLogin).filter((l): l is string => !!l)),
      ],
      relatedCommits: toRelated(shown),
      recommendation:
        "Scan the burst commits on the timeline to confirm they belong to one expected effort.",
    },
  ];
}
