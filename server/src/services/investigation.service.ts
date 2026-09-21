import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import {
  ciRuns,
  ciWorkflows,
  commitFiles,
  commits,
  contributors,
  files,
  issueCommitLinks,
  issuePrLinks,
  issues,
  pullRequests,
  prCommits,
  prFiles,
} from "../db/schema.js";
import { analyzeRepositoryRisks } from "./risk.service.js";
import { detectIncidents } from "./incident-intelligence.service.js";
import { getLogger } from "../utils/logger.js";

export type InvestigationEntityType =
  | "commit"
  | "file"
  | "pr"
  | "issue"
  | "run"
  | "workflow"
  | "incident"
  | "risk";

export interface InvestigationTarget {
  type: InvestigationEntityType;
  identifier: string;
}

/**
 * Normalize graph/API entity types (pull_request, ci_run, ci_workflow)
 * to canonical investigation types (pr, run, workflow). Pass-through for
 * already-canonical values. Returns null for unsupported types.
 */
export function normalizeInvestigationType(
  rawType: string,
): InvestigationEntityType | null {
  const map: Record<string, InvestigationEntityType> = {
    commit: "commit",
    file: "file",
    pr: "pr",
    pull_request: "pr",
    issue: "issue",
    run: "run",
    ci_run: "run",
    ciRun: "run",
    workflow: "workflow",
    ci_workflow: "workflow",
    ciWorkflow: "workflow",
    incident: "incident",
    risk: "risk",
  };
  return map[rawType] ?? null;
}

export interface InvestigationContext {
  target: InvestigationTarget;
  directRelationships: DirectRelationships;
  temporalRelationships: TemporalRelationships;
  repeatedPatterns: RepeatedPatterns;
  evidence: EvidencePackage;
  unknowns: string[];
}

export interface DirectRelationships {
  commits: CommitRef[];
  files: FileRef[];
  prs: PrRef[];
  issues: IssueRef[];
  runs: RunRef[];
  workflows: WorkflowRef[];
  risks: RiskRef[];
  incidents: IncidentRef[];
  contributors: ContributorRef[];
}

export interface TemporalRelationships {
  changesBefore: CommitRef[];
  changesAfter: CommitRef[];
  incidentTimeline: IncidentTimelineEntry[];
}

export interface RepeatedPatterns {
  repeatedCiFailures: CiFailurePattern[];
  repeatedRiskyFiles: RiskyFilePattern[];
  repeatedIncidentAreas: IncidentAreaPattern[];
}

export interface EvidencePackage {
  commits: CommitRef[];
  files: FileRef[];
  prs: PrRef[];
  issues: IssueRef[];
  runs: RunRef[];
  workflows: WorkflowRef[];
  risks: RiskRef[];
  incidents: IncidentRef[];
  contributors: ContributorRef[];
}

export interface CommitRef {
  sha: string;
  shortSha: string;
  message: string | null;
  authorLogin: string | null;
  committedAt: Date | null;
  url: string | null;
}

export interface FileRef {
  path: string;
  area: string;
  changeCount: number;
  recentChanges: number;
  hot: boolean;
  contributors: string[];
  linkedCommits: string[];
  linkedPrs: number[];
  linkedIssues: number[];
}

export interface PrRef {
  id: string;
  number: number;
  title: string | null;
  state: string;
  merged: boolean;
  authorLogin: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  headSha: string | null;
  files: string[];
  commits: string[];
  githubCreatedAt: Date | null;
  githubUpdatedAt: Date | null;
  htmlUrl: string | null;
}

export interface IssueRef {
  number: number;
  title: string | null;
  state: string;
  authorLogin: string | null;
  linkedPrs: number[];
  linkedCommits: string[];
  files: string[];
  githubCreatedAt: Date | null;
  githubUpdatedAt: Date | null;
  htmlUrl: string | null;
}

export interface RunRef {
  githubId: string;
  runNumber: number | null;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  headBranch: string | null;
  headSha: string | null;
  workflowName: string | null;
  workflowGithubId: string | null;
  githubCreatedAt: Date | null;
  htmlUrl: string | null;
  prNumbers: number[];
}

export interface WorkflowRef {
  id: string;
  githubId: string;
  name: string | null;
  path: string | null;
  state: string | null;
}

export interface RiskRef {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  affectedFiles: string[];
  affectedContributors: string[];
}

export interface IncidentRef {
  fingerprint: string;
  title: string;
  status: string;
  severity: string;
  workflowGithubId: string;
  workflowName: string | null;
  branch: string;
  burstLength: number;
  burstStartAt: Date | null;
  burstEndAt: Date | null;
  filePaths: string[];
  linkedPrNumbers: number[];
  linkedIssueNumbers: number[];
  riskFindingIds: string[];
  evidence: Array<{ kind: string; value: string; label: string }>;
  timeline: IncidentTimelineEntry[];
  contributorLogins: string[];
}

export interface ContributorRef {
  login: string;
  name: string | null;
  commitCount: number;
  filesTouched: string[];
}

export interface IncidentTimelineEntry {
  at: Date | null;
  kind: "ci_failure" | "ci_recovery" | "commit" | "pr" | "issue";
  title: string;
  detail: string | null;
  ref: {
    kind: string;
    value: string;
    label: string;
  };
}

export interface CiFailurePattern {
  workflowGithubId: string;
  workflowName: string | null;
  branch: string;
  failureCount: number;
  streakLength: number;
  lastFailureAt: Date | null;
  runs: RunRef[];
}

export interface RiskyFilePattern {
  path: string;
  riskCount: number;
  incidentCount: number;
  totalChanges: number;
  severity: string;
}

export interface IncidentAreaPattern {
  workflowGithubId: string;
  workflowName: string | null;
  branch: string;
  incidentCount: number;
  fileOverlap: string[];
}

const MAX_EVIDENCE_ITEMS = 50;
const TEMPORAL_WINDOW_DAYS = 14;

async function getCommitRefs(repositoryId: string, shas: string[]): Promise<CommitRef[]> {
  if (shas.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      sha: commits.sha,
      message: commits.message,
      authorLogin: commits.authorLogin,
      committedAt: commits.committedAt,
      url: commits.url,
    })
    .from(commits)
    .where(and(eq(commits.repositoryId, repositoryId), inArray(commits.sha, shas)));
  return rows.map((r) => ({
    sha: r.sha,
    shortSha: r.sha.slice(0, 12),
    message: r.message,
    authorLogin: r.authorLogin,
    committedAt: r.committedAt,
    url: r.url,
  }));
}

async function getFileRefs(repositoryId: string, paths: string[]): Promise<FileRef[]> {
  if (paths.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({ path: files.path })
    .from(files)
    .where(and(eq(files.repositoryId, repositoryId), inArray(files.path, paths)));
  const filePaths = rows.map((r) => r.path);

  const fileDetails = await Promise.all(
    filePaths.map(async (path) => {
      const [commitRows, prRows, issueRows, contributorRows] = await Promise.all([
        db
          .select({ sha: commits.sha })
          .from(commitFiles)
          .innerJoin(commits, eq(commitFiles.commitId, commits.id))
          .where(and(eq(commitFiles.repositoryId, repositoryId), eq(commitFiles.path, path))),
        db
          .select({ number: pullRequests.number })
          .from(prFiles)
          .innerJoin(pullRequests, eq(prFiles.pullRequestId, pullRequests.id))
          .where(and(eq(prFiles.repositoryId, repositoryId), eq(prFiles.path, path))),
        db
          .select({ number: issues.number })
          .from(issueCommitLinks)
          .innerJoin(commits, eq(issueCommitLinks.commitId, commits.id))
          .innerJoin(commitFiles, eq(commitFiles.commitId, commits.id))
          .innerJoin(issues, eq(issueCommitLinks.issueId, issues.id))
          .where(and(eq(issueCommitLinks.repositoryId, repositoryId), eq(commitFiles.path, path))),
        db
          .select({ login: commits.authorLogin })
          .from(commitFiles)
          .innerJoin(commits, eq(commitFiles.commitId, commits.id))
          .where(and(eq(commitFiles.repositoryId, repositoryId), eq(commitFiles.path, path))),
      ]);

      const recentChanges = await db
        .select({ count: sql<number>`count(*)` })
        .from(commitFiles)
        .innerJoin(commits, eq(commitFiles.commitId, commits.id))
        .where(
          and(
            eq(commitFiles.repositoryId, repositoryId),
            eq(commitFiles.path, path),
            sql`${commits.committedAt} > now() - interval '30 days'`,
          ),
        );

      const hot = (recentChanges[0]?.count ?? 0) >= 5;

      return {
        path,
        area: path.split("/")[0] || path,
        changeCount: commitRows.length,
        recentChanges: recentChanges[0]?.count ?? 0,
        hot,
        contributors: [...new Set(contributorRows.map((c) => c.login).filter((l): l is string => !!l))],
        linkedCommits: commitRows.map((c) => c.sha.slice(0, 12)),
        linkedPrs: [...new Set(prRows.map((p) => p.number))],
        linkedIssues: [...new Set(issueRows.map((i) => i.number))],
      };
    }),
  );

  return fileDetails;
}

async function getPrRefs(repositoryId: string, numbers: number[]): Promise<PrRef[]> {
  if (numbers.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: pullRequests.id,
      number: pullRequests.number,
      title: pullRequests.title,
      state: pullRequests.state,
      merged: pullRequests.merged,
      authorLogin: pullRequests.authorLogin,
      sourceBranch: pullRequests.sourceBranch,
      targetBranch: pullRequests.targetBranch,
      headSha: pullRequests.headSha,
      githubCreatedAt: pullRequests.githubCreatedAt,
      githubUpdatedAt: pullRequests.githubUpdatedAt,
      htmlUrl: pullRequests.htmlUrl,
    })
    .from(pullRequests)
    .where(and(eq(pullRequests.repositoryId, repositoryId), inArray(pullRequests.number, numbers)));

  return Promise.all(
    rows.map(async (r) => {
      const [fileRows, commitRows] = await Promise.all([
        db.select({ path: prFiles.path }).from(prFiles).where(eq(prFiles.pullRequestId, r.id)),
        db
          .select({ sha: commits.sha })
          .from(prCommits)
          .innerJoin(commits, eq(prCommits.commitId, commits.id))
          .where(eq(prCommits.pullRequestId, r.id)),
      ]);
      return {
        id: r.id,
        number: r.number,
        title: r.title,
        state: r.state,
        merged: r.merged,
        authorLogin: r.authorLogin,
        sourceBranch: r.sourceBranch,
        targetBranch: r.targetBranch,
        headSha: r.headSha,
        files: fileRows.map((f) => f.path),
        commits: commitRows.map((c) => c.sha.slice(0, 12)),
        githubCreatedAt: r.githubCreatedAt,
        githubUpdatedAt: r.githubUpdatedAt,
        htmlUrl: r.htmlUrl,
      };
    }),
  );
}

async function getIssueRefs(repositoryId: string, numbers: number[]): Promise<IssueRef[]> {
  if (numbers.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: issues.id,
      number: issues.number,
      title: issues.title,
      state: issues.state,
      authorLogin: issues.authorLogin,
      githubCreatedAt: issues.githubCreatedAt,
      githubUpdatedAt: issues.githubUpdatedAt,
      htmlUrl: issues.htmlUrl,
    })
    .from(issues)
    .where(and(eq(issues.repositoryId, repositoryId), inArray(issues.number, numbers)));

  return Promise.all(
    rows.map(async (r) => {
      const [prLinkRows, commitLinkRows, fileRows] = await Promise.all([
        db
          .select({ number: pullRequests.number })
          .from(issuePrLinks)
          .innerJoin(pullRequests, eq(issuePrLinks.pullRequestId, pullRequests.id))
          .where(and(eq(issuePrLinks.repositoryId, repositoryId), eq(issuePrLinks.issueId, r.id))),
        db
          .select({ sha: commits.sha })
          .from(issueCommitLinks)
          .innerJoin(commits, eq(issueCommitLinks.commitId, commits.id))
          .where(and(eq(issueCommitLinks.repositoryId, repositoryId), eq(issueCommitLinks.issueId, r.id))),
        db
          .select({ path: commitFiles.path })
          .from(issueCommitLinks)
          .innerJoin(commits, eq(issueCommitLinks.commitId, commits.id))
          .innerJoin(commitFiles, eq(commitFiles.commitId, commits.id))
          .where(and(eq(issueCommitLinks.repositoryId, repositoryId), eq(issueCommitLinks.issueId, r.id))),
      ]);
      return {
        number: r.number,
        title: r.title,
        state: r.state,
        authorLogin: r.authorLogin,
        linkedPrs: [...new Set(prLinkRows.map((p) => p.number))],
        linkedCommits: [...new Set(commitLinkRows.map((c) => c.sha.slice(0, 12)))],
        files: [...new Set(fileRows.map((f) => f.path))],
        githubCreatedAt: r.githubCreatedAt,
        githubUpdatedAt: r.githubUpdatedAt,
        htmlUrl: r.htmlUrl,
      };
    }),
  );
}

async function getRunRefs(repositoryId: string, githubIds: string[]): Promise<RunRef[]> {
  if (githubIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      githubId: ciRuns.githubId,
      runNumber: ciRuns.runNumber,
      name: ciRuns.name,
      status: ciRuns.status,
      conclusion: ciRuns.conclusion,
      headBranch: ciRuns.headBranch,
      headSha: ciRuns.headSha,
      githubCreatedAt: ciRuns.githubCreatedAt,
      htmlUrl: ciRuns.htmlUrl,
      workflowId: ciRuns.workflowId,
      prNumbers: ciRuns.prNumbers,
    })
    .from(ciRuns)
    .where(and(eq(ciRuns.repositoryId, repositoryId), inArray(ciRuns.githubId, githubIds)));

  const workflowIds = [...new Set(rows.map((r) => r.workflowId))];
  const workflowRows = await db
    .select({ id: ciWorkflows.id, name: ciWorkflows.name, githubId: ciWorkflows.githubId })
    .from(ciWorkflows)
    .where(inArray(ciWorkflows.id, workflowIds));
  const workflowById = new Map(workflowRows.map((w) => [w.id, w]));

  return rows.map((r) => ({
    githubId: r.githubId,
    runNumber: r.runNumber,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    headBranch: r.headBranch,
    headSha: r.headSha,
    workflowName: workflowById.get(r.workflowId)?.name ?? null,
    workflowGithubId: workflowById.get(r.workflowId)?.githubId ?? null,
    githubCreatedAt: r.githubCreatedAt,
    htmlUrl: r.htmlUrl,
    prNumbers: r.prNumbers ?? [],
  }));
}

async function getWorkflowRefs(repositoryId: string, githubIds: string[]): Promise<WorkflowRef[]> {
  if (githubIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: ciWorkflows.id,
      githubId: ciWorkflows.githubId,
      name: ciWorkflows.name,
      path: ciWorkflows.path,
      state: ciWorkflows.state,
    })
    .from(ciWorkflows)
    .where(and(eq(ciWorkflows.repositoryId, repositoryId), inArray(ciWorkflows.githubId, githubIds)));
  return rows.map((r) => ({
    id: r.id,
    githubId: r.githubId,
    name: r.name,
    path: r.path,
    state: r.state,
  }));
}

async function getRiskRefs(repositoryId: string, ids: string[]): Promise<RiskRef[]> {
  if (ids.length === 0) return [];
  const report = await analyzeRepositoryRisks(repositoryId);
  return report.findings
    .filter((f) => ids.includes(f.id))
    .map((f) => ({
      id: f.id,
      type: f.type,
      severity: f.severity,
      title: f.title,
      summary: f.summary,
      affectedFiles: f.affectedFiles,
      affectedContributors: f.affectedContributors,
    }));
}

async function getIncidentRefs(repositoryId: string, fingerprints: string[]): Promise<IncidentRef[]> {
  if (fingerprints.length === 0) return [];
  const incidents = await detectIncidents(repositoryId);
  return incidents
    .filter((i) => fingerprints.includes(i.fingerprint))
    .map((i) => ({
      fingerprint: i.fingerprint,
      title: i.title,
      status: i.status,
      severity: i.severity,
      workflowGithubId: i.workflowGithubId,
      workflowName: i.workflowName,
      branch: i.branch,
      burstLength: i.burstLength,
      burstStartAt: i.burstStartAt,
      burstEndAt: i.burstEndAt,
      filePaths: i.filePaths,
      linkedPrNumbers: i.linkedPrNumbers,
      linkedIssueNumbers: i.linkedIssueNumbers,
      riskFindingIds: i.riskFindingIds,
      evidence: i.evidence,
      timeline: i.timeline,
      contributorLogins: i.contributorLogins,
    }));
}

async function getContributorRefs(repositoryId: string, logins: string[]): Promise<ContributorRef[]> {
  if (logins.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      login: contributors.login,
      name: contributors.name,
    })
    .from(contributors)
    .where(and(eq(contributors.repositoryId, repositoryId), inArray(contributors.login, logins)));

  return Promise.all(
    rows.map(async (r) => {
      const commitRows = await db
        .select({ sha: commits.sha })
        .from(commits)
        .where(and(eq(commits.repositoryId, repositoryId), eq(commits.authorLogin, r.login)));
      const fileRows = await db
        .select({ path: commitFiles.path })
        .from(commitFiles)
        .innerJoin(commits, eq(commitFiles.commitId, commits.id))
        .where(and(eq(commitFiles.repositoryId, repositoryId), eq(commits.authorLogin, r.login)));
      return {
        login: r.login,
        name: r.name,
        commitCount: commitRows.length,
        filesTouched: [...new Set(fileRows.map((f) => f.path))],
      };
    }),
  );
}

/**
 * Build an investigation context for a target entity.
 * This assembles all deterministically derivable relationships from the
 * synchronized repository data. No inference, no LLM.
 * Accepts both canonical (pr/run/workflow) and graph (pull_request/ci_run/ci_workflow) type names.
 */
export async function buildInvestigationContext(
  repositoryId: string,
  rawTarget: InvestigationTarget | { type: string; identifier: string },
): Promise<InvestigationContext> {
  const logger = getLogger();
  const started = Date.now();

  const normalizedType = normalizeInvestigationType(rawTarget.type);
  if (!normalizedType) {
    throw new Error(`Unsupported investigation entity type: ${rawTarget.type}`);
  }
  const target: InvestigationTarget = {
    type: normalizedType,
    identifier: rawTarget.identifier,
  };

  let direct: DirectRelationships = {
    commits: [],
    files: [],
    prs: [],
    issues: [],
    runs: [],
    workflows: [],
    risks: [],
    incidents: [],
    contributors: [],
  };

  switch (target.type) {
    case "commit": {
      const commitRefs = await getCommitRefs(repositoryId, [target.identifier]);
      if (commitRefs.length === 0) break;
      const commit = commitRefs[0];

      // Link tables key commits by UUID (commits.id) — resolve via a join
      // on the SHA, never by comparing the UUID column to the SHA string.
      const fileRows = await getDb()
        .select({ path: commitFiles.path })
        .from(commitFiles)
        .innerJoin(commits, eq(commitFiles.commitId, commits.id))
        .where(and(eq(commitFiles.repositoryId, repositoryId), eq(commits.sha, commit.sha)));
      const filePaths = [...new Set(fileRows.map((f) => f.path))];

      const prRows = await getDb()
        .select({ number: pullRequests.number })
        .from(prCommits)
        .innerJoin(pullRequests, eq(prCommits.pullRequestId, pullRequests.id))
        .innerJoin(commits, eq(prCommits.commitId, commits.id))
        .where(and(eq(pullRequests.repositoryId, repositoryId), eq(commits.sha, commit.sha)));
      const prNumbers = [...new Set(prRows.map((p) => p.number))];

      const issueRows = await getDb()
        .select({ number: issues.number })
        .from(issueCommitLinks)
        .innerJoin(issues, eq(issueCommitLinks.issueId, issues.id))
        .innerJoin(commits, eq(issueCommitLinks.commitId, commits.id))
        .where(and(eq(issues.repositoryId, repositoryId), eq(commits.sha, commit.sha)));
      const issueNumbers = [...new Set(issueRows.map((i) => i.number))];

      const runRows = await getDb()
        .select({ githubId: ciRuns.githubId })
        .from(ciRuns)
        .where(and(eq(ciRuns.repositoryId, repositoryId), eq(ciRuns.headSha, commit.sha)));
      const runGithubIds = [...new Set(runRows.map((r) => r.githubId))];

      const [files, prs, issueRefs, runs] = await Promise.all([
        getFileRefs(repositoryId, filePaths),
        getPrRefs(repositoryId, prNumbers),
        getIssueRefs(repositoryId, issueNumbers),
        getRunRefs(repositoryId, runGithubIds),
      ]);

      direct = {
        commits: [commit],
        files,
        prs,
        issues: issueRefs,
        runs,
        workflows: [],
        risks: [],
        incidents: [],
        contributors: await getContributorRefs(repositoryId, [commit.authorLogin].filter((l): l is string => !!l)),
      };
      break;
    }

    case "file": {
      const fileRefs = await getFileRefs(repositoryId, [target.identifier]);
      if (fileRefs.length === 0) break;
      const file = fileRefs[0];

      // findFullSha is async: resolve every prefix before filtering, or the
      // array holds Promise objects that match nothing downstream.
      const commitShas = (
        await Promise.all(
          file.linkedCommits.map((s) => (s.length === 12 ? findFullSha(repositoryId, s) : s)),
        )
      ).filter((s): s is string => !!s);
      const prNumbers = file.linkedPrs;
      const issueNumbers = file.linkedIssues;

      const [commits, prs, issues, contributors] = await Promise.all([
        getCommitRefs(repositoryId, commitShas),
        getPrRefs(repositoryId, prNumbers),
        getIssueRefs(repositoryId, issueNumbers),
        getContributorRefs(repositoryId, file.contributors),
      ]);

      // Find risks affecting this file
      const riskReport = await analyzeRepositoryRisks(repositoryId);
      const riskRefs = await getRiskRefs(
        repositoryId,
        riskReport.findings.filter((f) => f.affectedFiles.includes(target.identifier)).map((f) => f.id),
      );

      // Find incidents involving this file
      const incidentList = await detectIncidents(repositoryId);
      const incidentRefs = await getIncidentRefs(
        repositoryId,
        incidentList.filter((i) => i.filePaths.includes(target.identifier)).map((i) => i.fingerprint),
      );

      direct = {
        commits,
        files: [file],
        prs,
        issues,
        runs: [],
        workflows: [],
        risks: riskRefs,
        incidents: incidentRefs,
        contributors,
      };
      break;
    }

    case "pr": {
      const prNumber = parseInt(target.identifier, 10);
      if (isNaN(prNumber)) break;

      const prRefs = await getPrRefs(repositoryId, [prNumber]);
      if (prRefs.length === 0) break;
      const pr = prRefs[0];

      const commitShas = (
        await Promise.all(
          pr.commits.map((s) => (s.length === 12 ? findFullSha(repositoryId, s) : s)),
        )
      ).filter((s): s is string => !!s);
      const filePaths = pr.files;
      const issueNumbers = await getLinkedIssueNumbersForPr(repositoryId, pr.id);

      const [commits, files, issueRefs, runs] = await Promise.all([
        getCommitRefs(repositoryId, commitShas),
        getFileRefs(repositoryId, filePaths),
        getIssueRefs(repositoryId, issueNumbers),
        getRunRefs(
          repositoryId,
          (await getDb()
            .select({ githubId: ciRuns.githubId, prNumbers: ciRuns.prNumbers })
            .from(ciRuns)
            .where(eq(ciRuns.repositoryId, repositoryId)))
            .filter((r) => r.prNumbers && Array.isArray(r.prNumbers) && r.prNumbers.includes(prNumber))
            .map((r) => r.githubId),
        ),
      ]);

      // Risks overlapping PR files
      const riskReport = await analyzeRepositoryRisks(repositoryId);
      const riskRefs = await getRiskRefs(
        repositoryId,
        riskReport.findings.filter((f) => f.affectedFiles.some((p) => filePaths.includes(p))).map((f) => f.id),
      );

      direct = {
        commits,
        files,
        prs: [pr],
        issues: issueRefs,
        runs,
        workflows: [],
        risks: riskRefs,
        incidents: [],
        contributors: await getContributorRefs(repositoryId, [...new Set([pr.authorLogin, ...commits.map((c) => c.authorLogin)].filter((l): l is string => !!l))]),
      };
      break;
    }

    case "issue": {
      const issueNumber = parseInt(target.identifier, 10);
      if (isNaN(issueNumber)) break;

      const issueRefs = await getIssueRefs(repositoryId, [issueNumber]);
      if (issueRefs.length === 0) break;
      const issue = issueRefs[0];

      const commitShas = (
        await Promise.all(
          issue.linkedCommits.map((s) => (s.length === 12 ? findFullSha(repositoryId, s) : s)),
        )
      ).filter((s): s is string => !!s);
      const filePaths = issue.files;

      const [commits, files, prs, runs] = await Promise.all([
        getCommitRefs(repositoryId, commitShas),
        getFileRefs(repositoryId, filePaths),
        getPrRefs(repositoryId, issue.linkedPrs),
        getRunRefs(
          repositoryId,
          (await getDb()
            .select({ githubId: ciRuns.githubId, prNumbers: ciRuns.prNumbers })
            .from(ciRuns)
            .where(eq(ciRuns.repositoryId, repositoryId)))
            .filter((r) => r.prNumbers && Array.isArray(r.prNumbers) && r.prNumbers.some((n) => issue.linkedPrs.includes(n)))
            .map((r) => r.githubId),
        ),
      ]);

      // Risks overlapping issue files
      const riskReport = await analyzeRepositoryRisks(repositoryId);
      const riskRefs = await getRiskRefs(
        repositoryId,
        riskReport.findings.filter((f) => f.affectedFiles.some((p) => filePaths.includes(p))).map((f) => f.id),
      );

      direct = {
        commits,
        files,
        prs,
        issues: [issue],
        runs,
        workflows: [],
        risks: riskRefs,
        incidents: [],
        contributors: await getContributorRefs(repositoryId, [...new Set([issue.authorLogin, ...commits.map((c) => c.authorLogin)].filter((l): l is string => !!l))]),
      };
      break;
    }

    case "run": {
      const runRefs = await getRunRefs(repositoryId, [target.identifier]);
      if (runRefs.length === 0) break;
      const run = runRefs[0];

      const commitShas = run.headSha ? [run.headSha] : [];
      const prNumbers = run.prNumbers ?? [];

      const [commits, files, prs, issueRefs] = await Promise.all([
        getCommitRefs(repositoryId, commitShas),
        commitShas.length > 0
          ? getFileRefs(repositoryId, await getFilePathsForCommits(repositoryId, commitShas))
          : Promise.resolve([]),
        getPrRefs(repositoryId, prNumbers),
        getIssueRefs(repositoryId, await getLinkedIssueNumbersForPrs(repositoryId, prNumbers)),
      ]);

      // Workflow
      const workflowRefs = run.workflowGithubId ? await getWorkflowRefs(repositoryId, [run.workflowGithubId]) : [];

      // Risks overlapping run files
      const riskReport = await analyzeRepositoryRisks(repositoryId);
      const riskRefs = await getRiskRefs(
        repositoryId,
        riskReport.findings.filter((f) => f.affectedFiles.some((p) => files.map((fl) => fl.path).includes(p))).map((f) => f.id),
      );

      // Incidents involving this run
      const incidentList = await detectIncidents(repositoryId);
      const incidentRefs = await getIncidentRefs(
        repositoryId,
        incidentList.filter((i) => i.evidence.some((e) => e.kind === "run" && e.value === target.identifier)).map((i) => i.fingerprint),
      );

      direct = {
        commits,
        files,
        prs,
        issues: issueRefs,
        runs: [run],
        workflows: workflowRefs,
        risks: riskRefs,
        incidents: incidentRefs,
        contributors: await getContributorRefs(repositoryId, [...new Set(commits.map((c) => c.authorLogin).filter((l): l is string => !!l))]),
      };
      break;
    }

    case "workflow": {
      const workflowRefs = await getWorkflowRefs(repositoryId, [target.identifier]);
      if (workflowRefs.length === 0) break;
      const workflow = workflowRefs[0];

      // Get recent runs for this workflow
      const runRows = await getDb()
        .select({ githubId: ciRuns.githubId })
        .from(ciRuns)
        .where(and(eq(ciRuns.repositoryId, repositoryId), eq(ciRuns.workflowId, workflow.id)))
        .orderBy(desc(ciRuns.githubCreatedAt))
        .limit(20);
      const runGithubIds = runRows.map((r) => r.githubId);

      const runRefs = await getRunRefs(repositoryId, runGithubIds);

      // Aggregate files, PRs, issues from runs
      const allCommitShas = [...new Set(runRefs.flatMap((r) => r.headSha ? [r.headSha] : []))];
      const allPrNumbers = [...new Set(runRefs.flatMap((r) => r.prNumbers ?? []))];

      const [files, prs, issues] = await Promise.all([
        allCommitShas.length > 0
          ? getFileRefs(repositoryId, await getFilePathsForCommits(repositoryId, allCommitShas))
          : Promise.resolve([]),
        getPrRefs(repositoryId, allPrNumbers),
        getIssueRefs(repositoryId, await getLinkedIssueNumbersForPrs(repositoryId, allPrNumbers)),
      ]);

      direct = {
        commits: [],
        files,
        prs,
        issues,
        runs: runRefs,
        workflows: [workflow],
        risks: [],
        incidents: [],
        contributors: [],
      };
      break;
    }

    case "incident": {
      const incidentRefs = await getIncidentRefs(repositoryId, [target.identifier]);
      if (incidentRefs.length === 0) break;
      const incident = incidentRefs[0];

      const [commits, files, prs, issues, runs, risks] = await Promise.all([
        getCommitRefs(repositoryId, incident.evidence.filter((e) => e.kind === "commit").map((e) => e.value)),
        getFileRefs(repositoryId, incident.filePaths),
        getPrRefs(repositoryId, incident.linkedPrNumbers),
        getIssueRefs(repositoryId, incident.linkedIssueNumbers),
        getRunRefs(repositoryId, incident.evidence.filter((e) => e.kind === "run").map((e) => e.value)),
        getRiskRefs(repositoryId, incident.riskFindingIds),
      ]);

      direct = {
        commits,
        files,
        prs,
        issues,
        runs,
        workflows: await getWorkflowRefs(repositoryId, [incident.workflowGithubId]),
        risks,
        incidents: [incident],
        contributors: incident.contributorLogins.length > 0
          ? await getContributorRefs(repositoryId, incident.contributorLogins)
          : [],
      };
      break;
    }

    case "risk": {
      const riskRefs = await getRiskRefs(repositoryId, [target.identifier]);
      if (riskRefs.length === 0) break;
      const risk = riskRefs[0];

      const [files, commits, contributors] = await Promise.all([
        getFileRefs(repositoryId, risk.affectedFiles),
        getCommitRefs(repositoryId, await getCommitsForFiles(repositoryId, risk.affectedFiles)),
        getContributorRefs(repositoryId, risk.affectedContributors),
      ]);

      // Incidents overlapping risk files
      const incidentList = await detectIncidents(repositoryId);
      const incidentRefs = await getIncidentRefs(
        repositoryId,
        incidentList.filter((i) => i.filePaths.some((p) => risk.affectedFiles.includes(p))).map((i) => i.fingerprint),
      );

      direct = {
        commits,
        files,
        prs: [],
        issues: [],
        runs: [],
        workflows: [],
        risks: [risk],
        incidents: incidentRefs,
        contributors,
      };
      break;
    }
  }

  // Temporal relationships
  const temporal = await buildTemporalRelationships(repositoryId, target, direct);

  // Repeated patterns
  const patterns = await detectRepeatedPatterns(repositoryId, direct);

  // Evidence package (flattened for AI context)
  const evidence: EvidencePackage = {
    commits: direct.commits.slice(0, MAX_EVIDENCE_ITEMS),
    files: direct.files.slice(0, MAX_EVIDENCE_ITEMS),
    prs: direct.prs.slice(0, MAX_EVIDENCE_ITEMS),
    issues: direct.issues.slice(0, MAX_EVIDENCE_ITEMS),
    runs: direct.runs.slice(0, MAX_EVIDENCE_ITEMS),
    workflows: direct.workflows.slice(0, MAX_EVIDENCE_ITEMS),
    risks: direct.risks.slice(0, MAX_EVIDENCE_ITEMS),
    incidents: direct.incidents.slice(0, MAX_EVIDENCE_ITEMS),
    contributors: direct.contributors.slice(0, MAX_EVIDENCE_ITEMS),
  };

  // Unknowns
  const unknowns = buildUnknowns(target, direct);

  logger.debug(
    { repositoryId, target, durationMs: Date.now() - started },
    "Investigation context built",
  );

  return {
    target,
    directRelationships: direct,
    temporalRelationships: temporal,
    repeatedPatterns: patterns,
    evidence,
    unknowns,
  };
}

async function buildTemporalRelationships(
  repositoryId: string,
  target: InvestigationTarget,
  direct: DirectRelationships,
): Promise<TemporalRelationships> {
  const db = getDb();

  let targetTime: Date | null = null;

  // Determine the reference time for the target
  switch (target.type) {
    case "commit": {
      if (direct.commits.length > 0) targetTime = direct.commits[0].committedAt;
      break;
    }
    case "incident": {
      if (direct.incidents.length > 0) targetTime = direct.incidents[0].burstEndAt;
      break;
    }
    case "run": {
      if (direct.runs.length > 0) targetTime = direct.runs[0].githubCreatedAt;
      break;
    }
    case "pr": {
      if (direct.prs.length > 0) targetTime = direct.prs[0].githubCreatedAt;
      break;
    }
    case "issue": {
      if (direct.issues.length > 0) targetTime = direct.issues[0].githubCreatedAt;
      break;
    }
  }

  const changesBefore: CommitRef[] = [];
  const changesAfter: CommitRef[] = [];

  if (targetTime) {
    const windowStart = new Date(targetTime.getTime() - TEMPORAL_WINDOW_DAYS * 86_400_000);
    const windowEnd = new Date(targetTime.getTime() + TEMPORAL_WINDOW_DAYS * 86_400_000);

    // Changes before target
    const beforeRows = await db
      .select({
        sha: commits.sha,
        message: commits.message,
        authorLogin: commits.authorLogin,
        committedAt: commits.committedAt,
        url: commits.url,
      })
      .from(commits)
      .where(
        and(
          eq(commits.repositoryId, repositoryId),
          sql`${commits.committedAt} >= ${windowStart.toISOString()}`,
          sql`${commits.committedAt} < ${targetTime.toISOString()}`,
        ),
      )
      .orderBy(desc(commits.committedAt))
      .limit(20);

    changesBefore.push(
      ...beforeRows.map((r) => ({
        sha: r.sha,
        shortSha: r.sha.slice(0, 12),
        message: r.message,
        authorLogin: r.authorLogin,
        committedAt: r.committedAt,
        url: r.url,
      })),
    );

    // Changes after target
    const afterRows = await db
      .select({
        sha: commits.sha,
        message: commits.message,
        authorLogin: commits.authorLogin,
        committedAt: commits.committedAt,
        url: commits.url,
      })
      .from(commits)
      .where(
        and(
          eq(commits.repositoryId, repositoryId),
          sql`${commits.committedAt} > ${targetTime.toISOString()}`,
          sql`${commits.committedAt} <= ${windowEnd.toISOString()}`,
        ),
      )
      .orderBy(commits.committedAt)
      .limit(20);

    changesAfter.push(
      ...afterRows.map((r) => ({
        sha: r.sha,
        shortSha: r.sha.slice(0, 12),
        message: r.message,
        authorLogin: r.authorLogin,
        committedAt: r.committedAt,
        url: r.url,
      })),
    );
  }

  // Incident timeline if target is incident or related
  let incidentTimeline: IncidentTimelineEntry[] = [];
  if (target.type === "incident" && direct.incidents.length > 0) {
    const incident = direct.incidents[0];
    incidentTimeline = incident.timeline ?? [];
  }

  return { changesBefore, changesAfter, incidentTimeline };
}

async function detectRepeatedPatterns(
  _repositoryId: string,
  direct: DirectRelationships,
): Promise<RepeatedPatterns> {
  // Repeated CI failures
  const workflowRunMap = new Map<string, RunRef[]>();
  for (const run of direct.runs) {
    if (run.workflowGithubId) {
      const list = workflowRunMap.get(run.workflowGithubId) ?? [];
      list.push(run);
      workflowRunMap.set(run.workflowGithubId, list);
    }
  }

  const repeatedCiFailures: CiFailurePattern[] = [];
  for (const [workflowGithubId, runs] of workflowRunMap.entries()) {
    const failures = runs.filter((r) => r.conclusion && ["failure", "timed_out", "startup_failure"].includes(r.conclusion));
    if (failures.length >= 2) {
      const streak = runs
        .slice(0, 10)
        .reduce((acc, r) => {
          if (r.conclusion && ["failure", "timed_out", "startup_failure"].includes(r.conclusion)) return acc + 1;
          return acc === 0 ? 0 : acc;
        }, 0);
      repeatedCiFailures.push({
        workflowGithubId,
        workflowName: runs[0]?.workflowName ?? null,
        branch: runs[0]?.headBranch ?? "unknown",
        failureCount: failures.length,
        streakLength: streak,
        lastFailureAt: failures[0]?.githubCreatedAt ?? null,
        runs: runs.slice(0, 5),
      });
    }
  }

  // Repeated risky files
  const fileRiskCount = new Map<string, number>();
  for (const risk of direct.risks) {
    for (const filePath of risk.affectedFiles) {
      fileRiskCount.set(filePath, (fileRiskCount.get(filePath) ?? 0) + 1);
    }
  }

  const repeatedRiskyFiles: RiskyFilePattern[] = [...fileRiskCount.entries()]
    .filter(([, count]) => count >= 2)
    .map(([path, riskCount]) => {
      const file = direct.files.find((f) => f.path === path);
      const incidentCount = direct.incidents.filter((i) => i.filePaths.includes(path)).length;
      return {
        path,
        riskCount,
        incidentCount,
        totalChanges: file?.changeCount ?? 0,
        severity: riskCount >= 3 ? "critical" : riskCount >= 2 ? "high" : "medium",
      };
    })
    .sort((a, b) => b.riskCount - a.riskCount || b.incidentCount - a.incidentCount)
    .slice(0, 10);

  // Repeated incident areas
  const workflowIncidentMap = new Map<string, IncidentRef[]>();
  for (const incident of direct.incidents) {
    const list = workflowIncidentMap.get(incident.workflowGithubId) ?? [];
    list.push(incident);
    workflowIncidentMap.set(incident.workflowGithubId, list);
  }

  const repeatedIncidentAreas: IncidentAreaPattern[] = [...workflowIncidentMap.entries()]
    .filter(([, incidents]) => incidents.length >= 2)
    .map(([workflowGithubId, incidents]) => {
      const fileOverlap = [...new Set(incidents.flatMap((i) => i.filePaths))];
      return {
        workflowGithubId,
        workflowName: incidents[0]?.workflowName ?? null,
        branch: incidents[0]?.branch ?? "unknown",
        incidentCount: incidents.length,
        fileOverlap,
      };
    })
    .slice(0, 10);

  return { repeatedCiFailures, repeatedRiskyFiles, repeatedIncidentAreas };
}

function buildUnknowns(target: InvestigationTarget, direct: DirectRelationships): string[] {
  const unknowns: string[] = [];

  if (direct.commits.length === 0 && target.type !== "commit") {
    unknowns.push("No commits found in the investigation context.");
  }
  if (direct.files.length === 0) {
    unknowns.push("No files found in the investigation context.");
  }
  if (direct.prs.length === 0) {
    unknowns.push("No pull requests found in the investigation context.");
  }
  if (direct.runs.length === 0) {
    unknowns.push("No CI runs found in the investigation context.");
  }
  if (direct.risks.length === 0) {
    unknowns.push("No risk findings in the investigation context.");
  }

  unknowns.push(
    "Production impact is unknown — no production telemetry is available.",
    "Root cause is not established — temporal correlation is not causation.",
    "CI logs are unavailable — failure reasons beyond conclusions cannot be determined.",
  );

  return unknowns;
}

async function findFullSha(repositoryId: string, shortSha: string): Promise<string | null> {
  const db = getDb();
  // Prefix match only: the wildcard stays inside the bound parameter so the
  // short SHA can never break out of the LIKE pattern.
  if (!/^[0-9a-f]{7,39}$/i.test(shortSha)) return null;
  const row = await db
    .select({ sha: commits.sha })
    .from(commits)
    .where(and(eq(commits.repositoryId, repositoryId), like(commits.sha, `${shortSha.toLowerCase()}%`)))
    .limit(1);
  return row[0]?.sha ?? null;
}

async function getLinkedIssueNumbersForPr(repositoryId: string, prId: string): Promise<number[]> {
  const db = getDb();
  const rows = await db
    .select({ number: issues.number })
    .from(issuePrLinks)
    .innerJoin(issues, eq(issuePrLinks.issueId, issues.id))
    .where(and(eq(issuePrLinks.repositoryId, repositoryId), eq(issuePrLinks.pullRequestId, prId)));
  return [...new Set(rows.map((r) => r.number))];
}

async function getLinkedIssueNumbersForPrs(repositoryId: string, prNumbers: number[]): Promise<number[]> {
  if (prNumbers.length === 0) return [];
  const db = getDb();
  const prRows = await db
    .select({ id: pullRequests.id })
    .from(pullRequests)
    .where(and(eq(pullRequests.repositoryId, repositoryId), inArray(pullRequests.number, prNumbers)));
  const prIds = prRows.map((p) => p.id);
  if (prIds.length === 0) return [];

  const rows = await db
    .select({ number: issues.number })
    .from(issuePrLinks)
    .innerJoin(issues, eq(issuePrLinks.issueId, issues.id))
    .where(and(eq(issuePrLinks.repositoryId, repositoryId), inArray(issuePrLinks.pullRequestId, prIds)));
  return [...new Set(rows.map((r) => r.number))];
}

async function getFilePathsForCommits(repositoryId: string, shas: string[]): Promise<string[]> {
  if (shas.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({ path: commitFiles.path })
    .from(commitFiles)
    .innerJoin(commits, eq(commitFiles.commitId, commits.id))
    .where(and(eq(commitFiles.repositoryId, repositoryId), inArray(commits.sha, shas)));
  return [...new Set(rows.map((r) => r.path))];
}

async function getCommitsForFiles(repositoryId: string, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({ sha: commits.sha })
    .from(commitFiles)
    .innerJoin(commits, eq(commitFiles.commitId, commits.id))
    .where(and(eq(commitFiles.repositoryId, repositoryId), inArray(commitFiles.path, paths)));
  return [...new Set(rows.map((r) => r.sha))];
}