import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import {
  ciRuns,
  ciWorkflows,
  commitFiles,
  commits,
  contributors,
  files,
  issues,
  pullRequests,
  prCommits,
  prFiles,
} from "../db/schema.js";
import { detectIncidents } from "./incident-intelligence.service.js";
import { analyzeRepositoryRisks } from "./risk.service.js";
import { getRepositoryById } from "./repository.service.js";
import { getLogger } from "../utils/logger.js";

export type GraphNodeType =
  | "repository"
  | "commit"
  | "file"
  | "contributor"
  | "pull_request"
  | "issue"
  | "ci_workflow"
  | "ci_run"
  | "risk"
  | "incident";

export type GraphEdgeType =
  | "contains"
  | "has"
  | "changes"
  | "authored_by"
  | "contains_commit"
  | "affects"
  | "links_to"
  | "triggers"
  | "belongs_to"
  | "executes_on"
  | "composed_of"
  | "relates_to"
  | "affects_file"
  | "associated_with";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: GraphEdgeType;
  evidenceIds: string[];
  provenance: {
    source: string;
    reason: string;
  };
}

export interface GraphResponse {
  repositoryId: string;
  root?: {
    id: string;
    type: GraphNodeType;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    depth: number;
    nodeCount: number;
    edgeCount: number;
    truncated: boolean;
  };
}

export interface GraphQueryOptions {
  entityType?: string;
  entityId?: string;
  depth?: number;
  limit?: number;
}

const GRAPH_LIMITS = {
  defaultDepth: 2,
  maxDepth: 3,
  defaultLimit: 200,
  maxLimit: 500,
  maxNodes: 500,
  maxEdges: 1000,
} as const;

function makeNodeId(type: GraphNodeType, ...parts: string[]): string {
  return `${type}:${parts.join(":")}`;
}

function makeEdgeId(sourceId: string, targetId: string, type: GraphEdgeType): string {
  return `${sourceId}->${type}->${targetId}`;
}

function stableNodeId(type: GraphNodeType, repositoryId: string, identifier: string): string {
  return makeNodeId(type, repositoryId, identifier);
}

async function getRiskReport(repositoryId: string) {
  return analyzeRepositoryRisks(repositoryId);
}

export async function buildGraph(
  repositoryId: string,
  options: GraphQueryOptions = {},
): Promise<GraphResponse> {
  const logger = getLogger();
  const started = Date.now();

  const repo = await getRepositoryById(repositoryId);
  if (!repo) {
    throw new Error("Repository not found");
  }

  const depth = Math.min(Math.max(1, options.depth ?? GRAPH_LIMITS.defaultDepth), GRAPH_LIMITS.maxDepth);
  const limit = Math.min(Math.max(1, options.limit ?? GRAPH_LIMITS.defaultLimit), GRAPH_LIMITS.maxLimit);

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const visitedEdges = new Set<string>();

  const addNode = (node: GraphNode): void => {
    if (!nodes.has(node.id) && nodes.size < GRAPH_LIMITS.maxNodes) {
      nodes.set(node.id, node);
    }
  };

  const addEdge = (edge: GraphEdge): void => {
    const key = `${edge.sourceId}->${edge.type}->${edge.targetId}`;
    if (!visitedEdges.has(key) && edges.size < GRAPH_LIMITS.maxEdges) {
      visitedEdges.add(key);
      edges.set(edge.id, edge);
    }
  };

  // Repository node (always included as root)
  addNode({
    id: stableNodeId("repository", repositoryId, repo.id),
    type: "repository",
    label: repo.fullName,
    metadata: {
      id: repo.id,
      owner: repo.owner,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
      isPrivate: repo.isPrivate,
    },
  });

  let rootId: string | undefined;
  if (options.entityType && options.entityId) {
    rootId = stableNodeId(options.entityType as GraphNodeType, repositoryId, options.entityId);
  }

  // Load repository-scoped entities (bounded)
  const [
    commitsList,
    filesList,
    contributorsList,
    prsList,
    issuesList,
    workflowsList,
    runsList,
    riskReport,
    incidentList,
    prFilesList,
    prCommitsList,
  ] = await Promise.all([
    loadCommits(repositoryId, limit),
    loadFiles(repositoryId, limit),
    loadContributors(repositoryId, limit),
    loadPullRequests(repositoryId, limit),
    loadIssues(repositoryId, limit),
    loadWorkflows(repositoryId, limit),
    loadRuns(repositoryId, limit),
    getRiskReport(repositoryId),
    detectIncidents(repositoryId),
    loadPrFiles(repositoryId, limit),
    loadPrCommits(repositoryId, limit),
  ]);

  // Build nodes for each entity type
  buildCommitNodes(commitsList, addNode, repositoryId);
  buildFileNodes(filesList, addNode, repositoryId);
  buildContributorNodes(contributorsList, addNode, repositoryId);
  buildPrNodes(prsList, addNode, repositoryId);
  buildIssueNodes(issuesList, addNode, repositoryId);
  buildWorkflowNodes(workflowsList, addNode, repositoryId);
  buildRunNodes(runsList, addNode, repositoryId);
  buildRiskNodes(riskReport.findings, addNode, repositoryId);
  buildIncidentNodes(incidentList, addNode, repositoryId);

  // Build edges
  buildRepositoryEdges(repo, nodes, addEdge, repositoryId);
  buildCommitEdges(commitsList, nodes, addEdge, repositoryId);
  buildFileEdges(filesList, commitFiles, nodes, addEdge, repositoryId);
  buildContributorEdges(contributorsList, commitsList, nodes, addEdge, repositoryId);
  buildPrEdges(prsList, nodes, addEdge, repositoryId, prFilesList, prCommitsList);
  buildIssueEdges(issuesList, nodes, addEdge, repositoryId);
  buildWorkflowEdges(workflowsList, nodes, addEdge, repositoryId);
  buildRunEdges(runsList, nodes, addEdge, repositoryId, workflowsList);
  buildRiskEdges(riskReport.findings, nodes, addEdge, repositoryId);
  buildIncidentEdges(incidentList, nodes, addEdge, repositoryId);

  // If root entity specified, ensure it's included and compute subgraph
  let finalNodes = Array.from(nodes.values());
  let finalEdges = Array.from(edges.values());

  if (options.entityType && options.entityId && depth > 0) {
    const { nodes: subNodes, edges: subEdges } = extractSubgraph(
      rootId!,
      finalNodes,
      finalEdges,
      depth,
    );
    finalNodes = subNodes;
    finalEdges = subEdges;
  }

  // Truncation flag
  const truncated =
    nodes.size >= GRAPH_LIMITS.maxNodes || edges.size >= GRAPH_LIMITS.maxEdges;

  logger.debug(
    {
      repositoryId,
      nodes: finalNodes.length,
      edges: finalEdges.length,
      depth,
      truncated,
      durationMs: Date.now() - started,
    },
    "Graph built",
  );

  return {
    repositoryId,
    root: rootId ? { id: rootId, type: options.entityType as GraphNodeType } : undefined,
    nodes: finalNodes,
    edges: finalEdges,
    meta: {
      depth,
      nodeCount: finalNodes.length,
      edgeCount: finalEdges.length,
      truncated,
    },
  };
}

function extractSubgraph(
  rootId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  maxDepth: number,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const adjacency = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    const sourceEdges = adjacency.get(edge.sourceId) ?? [];
    sourceEdges.push(edge);
    adjacency.set(edge.sourceId, sourceEdges);
    const targetEdges = adjacency.get(edge.targetId) ?? [];
    targetEdges.push(edge);
    adjacency.set(edge.targetId, targetEdges);
  }

  const visited = new Set<string>();
  const visitedEdges = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth >= maxDepth) continue;
    visited.add(id);

    const connectedEdges = adjacency.get(id) ?? [];
    for (const edge of connectedEdges) {
      if (visitedEdges.has(edge.id)) continue;
      visitedEdges.add(edge.id);
      const neighborId = edge.sourceId === id ? edge.targetId : edge.sourceId;
      if (!visited.has(neighborId) && depth + 1 <= maxDepth) {
        queue.push({ id: neighborId, depth: depth + 1 });
      }
    }
  }

  const subNodes = nodes.filter((n) => visited.has(n.id));
  const subEdges = edges.filter((e) => visited.has(e.sourceId) && visited.has(e.targetId));

  return { nodes: subNodes, edges: subEdges };
}

async function loadCommits(repositoryId: string, limit: number) {
  const db = getDb();
  return db
    .select({
      id: commits.id,
      sha: commits.sha,
      message: commits.message,
      authorLogin: commits.authorLogin,
      authorName: commits.authorName,
      authorEmail: commits.authorEmail,
      committedAt: commits.committedAt,
      contributorId: commits.contributorId,
    })
    .from(commits)
    .where(eq(commits.repositoryId, repositoryId))
    .orderBy(desc(commits.committedAt))
    .limit(limit);
}

async function loadFiles(repositoryId: string, limit: number) {
  const db = getDb();
  return db
    .select({
      id: files.id,
      path: files.path,
      sha: files.sha,
      type: files.type,
      size: files.size,
    })
    .from(files)
    .where(eq(files.repositoryId, repositoryId))
    .orderBy(files.path)
    .limit(limit);
}

async function loadContributors(repositoryId: string, limit: number) {
  const db = getDb();
  return db
    .select({
      id: contributors.id,
      githubId: contributors.githubId,
      login: contributors.login,
      name: contributors.name,
      email: contributors.email,
      avatarUrl: contributors.avatarUrl,
    })
    .from(contributors)
    .where(eq(contributors.repositoryId, repositoryId))
    .orderBy(desc(contributors.createdAt))
    .limit(limit);
}

async function loadPullRequests(repositoryId: string, limit: number) {
  const db = getDb();
  return db
    .select({
      id: pullRequests.id,
      githubId: pullRequests.githubId,
      number: pullRequests.number,
      title: pullRequests.title,
      body: pullRequests.body,
      state: pullRequests.state,
      draft: pullRequests.draft,
      merged: pullRequests.merged,
      authorLogin: pullRequests.authorLogin,
      authorGithubId: pullRequests.authorGithubId,
      sourceBranch: pullRequests.sourceBranch,
      targetBranch: pullRequests.targetBranch,
      headSha: pullRequests.headSha,
      baseSha: pullRequests.baseSha,
      mergeCommitSha: pullRequests.mergeCommitSha,
      htmlUrl: pullRequests.htmlUrl,
      additions: pullRequests.additions,
      deletions: pullRequests.deletions,
      changedFilesCount: pullRequests.changedFilesCount,
      githubCreatedAt: pullRequests.githubCreatedAt,
      githubUpdatedAt: pullRequests.githubUpdatedAt,
      closedAt: pullRequests.closedAt,
      mergedAt: pullRequests.mergedAt,
    })
    .from(pullRequests)
    .where(eq(pullRequests.repositoryId, repositoryId))
    .orderBy(desc(pullRequests.githubUpdatedAt))
    .limit(limit);
}

async function loadIssues(repositoryId: string, limit: number) {
  const db = getDb();
  return db
    .select({
      id: issues.id,
      githubId: issues.githubId,
      number: issues.number,
      title: issues.title,
      body: issues.body,
      state: issues.state,
      stateReason: issues.stateReason,
      authorLogin: issues.authorLogin,
      authorGithubId: issues.authorGithubId,
      authorAssociation: issues.authorAssociation,
      htmlUrl: issues.htmlUrl,
      locked: issues.locked,
      commentsCount: issues.commentsCount,
      labels: issues.labels,
      milestoneNumber: issues.milestoneNumber,
      milestoneTitle: issues.milestoneTitle,
      milestoneState: issues.milestoneState,
      assignees: issues.assignees,
      githubCreatedAt: issues.githubCreatedAt,
      githubUpdatedAt: issues.githubUpdatedAt,
      closedAt: issues.closedAt,
    })
    .from(issues)
    .where(eq(issues.repositoryId, repositoryId))
    .orderBy(desc(issues.githubUpdatedAt))
    .limit(limit);
}

async function loadWorkflows(repositoryId: string, limit: number) {
  const db = getDb();
  return db
    .select({
      id: ciWorkflows.id,
      githubId: ciWorkflows.githubId,
      name: ciWorkflows.name,
      path: ciWorkflows.path,
      state: ciWorkflows.state,
      badgeUrl: ciWorkflows.badgeUrl,
      htmlUrl: ciWorkflows.htmlUrl,
      githubCreatedAt: ciWorkflows.githubCreatedAt,
      githubUpdatedAt: ciWorkflows.githubUpdatedAt,
    })
    .from(ciWorkflows)
    .where(eq(ciWorkflows.repositoryId, repositoryId))
    .orderBy(desc(ciWorkflows.githubCreatedAt))
    .limit(limit);
}

async function loadRuns(repositoryId: string, limit: number) {
  const db = getDb();
  return db
    .select({
      id: ciRuns.id,
      workflowId: ciRuns.workflowId,
      githubId: ciRuns.githubId,
      runNumber: ciRuns.runNumber,
      name: ciRuns.name,
      event: ciRuns.event,
      status: ciRuns.status,
      conclusion: ciRuns.conclusion,
      headBranch: ciRuns.headBranch,
      headSha: ciRuns.headSha,
      runAttempt: ciRuns.runAttempt,
      actorLogin: ciRuns.actorLogin,
      prNumbers: ciRuns.prNumbers,
      htmlUrl: ciRuns.htmlUrl,
      durationSec: ciRuns.durationSec,
      githubCreatedAt: ciRuns.githubCreatedAt,
      githubUpdatedAt: ciRuns.githubUpdatedAt,
      startedAt: ciRuns.startedAt,
      completedAt: ciRuns.completedAt,
    })
    .from(ciRuns)
    .where(eq(ciRuns.repositoryId, repositoryId))
    .orderBy(desc(ciRuns.githubCreatedAt))
    .limit(limit);
}

async function loadPrFiles(repositoryId: string, limit: number) {
  const db = getDb();
  return db
    .select({
      pullRequestId: prFiles.pullRequestId,
      path: prFiles.path,
      status: prFiles.status,
      additions: prFiles.additions,
      deletions: prFiles.deletions,
    })
    .from(prFiles)
    .where(eq(prFiles.repositoryId, repositoryId))
    .limit(limit);
}

async function loadPrCommits(repositoryId: string, limit: number) {
  const db = getDb();
  return db
    .select({
      pullRequestId: prCommits.pullRequestId,
      commitId: prCommits.commitId,
    })
    .from(prCommits)
    .innerJoin(pullRequests, eq(prCommits.pullRequestId, pullRequests.id))
    .where(eq(pullRequests.repositoryId, repositoryId))
    .limit(limit);
}

function buildCommitNodes(
  commitsList: Awaited<ReturnType<typeof loadCommits>>,
  addNode: (node: GraphNode) => void,
  repositoryId: string,
): void {
  for (const c of commitsList) {
    addNode({
      id: stableNodeId("commit", repositoryId, c.sha),
      type: "commit",
      label: `${c.sha.slice(0, 7)} ${(c.message ?? "").split("\n")[0] || "(no message)"}`,
      metadata: {
        sha: c.sha,
        message: c.message,
        authorLogin: c.authorLogin,
        authorName: c.authorName,
        authorEmail: c.authorEmail,
        committedAt: c.committedAt?.toISOString() ?? null,
      },
    });
  }
}

function buildFileNodes(
  filesList: Awaited<ReturnType<typeof loadFiles>>,
  addNode: (node: GraphNode) => void,
  repositoryId: string,
): void {
  for (const f of filesList) {
    addNode({
      id: stableNodeId("file", repositoryId, f.path),
      type: "file",
      label: f.path,
      metadata: {
        path: f.path,
        sha: f.sha,
        type: f.type,
        size: f.size,
      },
    });
  }
}

function buildContributorNodes(
  contributorsList: Awaited<ReturnType<typeof loadContributors>>,
  addNode: (node: GraphNode) => void,
  repositoryId: string,
): void {
  for (const c of contributorsList) {
    addNode({
      id: stableNodeId("contributor", repositoryId, c.login),
      type: "contributor",
      label: c.login,
      metadata: {
        login: c.login,
        name: c.name,
        email: c.email,
        avatarUrl: c.avatarUrl,
        githubId: c.githubId,
      },
    });
  }
}

function buildPrNodes(
  prsList: Awaited<ReturnType<typeof loadPullRequests>>,
  addNode: (node: GraphNode) => void,
  repositoryId: string,
): void {
  for (const pr of prsList) {
    addNode({
      id: stableNodeId("pull_request", repositoryId, String(pr.number)),
      type: "pull_request",
      label: `PR #${pr.number} ${pr.title ?? ""}`.trim(),
      metadata: {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        draft: pr.draft,
        merged: pr.merged,
        authorLogin: pr.authorLogin,
        sourceBranch: pr.sourceBranch,
        targetBranch: pr.targetBranch,
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFilesCount: pr.changedFilesCount,
        githubCreatedAt: pr.githubCreatedAt?.toISOString() ?? null,
        githubUpdatedAt: pr.githubUpdatedAt?.toISOString() ?? null,
        htmlUrl: pr.htmlUrl,
      },
    });
  }
}

function buildIssueNodes(
  issuesList: Awaited<ReturnType<typeof loadIssues>>,
  addNode: (node: GraphNode) => void,
  repositoryId: string,
): void {
  for (const issue of issuesList) {
    addNode({
      id: stableNodeId("issue", repositoryId, String(issue.number)),
      type: "issue",
      label: `Issue #${issue.number} ${issue.title ?? ""}`.trim(),
      metadata: {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        authorLogin: issue.authorLogin,
        commentsCount: issue.commentsCount,
        labels: issue.labels,
        githubCreatedAt: issue.githubCreatedAt?.toISOString() ?? null,
        githubUpdatedAt: issue.githubUpdatedAt?.toISOString() ?? null,
        htmlUrl: issue.htmlUrl,
      },
    });
  }
}

function buildWorkflowNodes(
  workflowsList: Awaited<ReturnType<typeof loadWorkflows>>,
  addNode: (node: GraphNode) => void,
  repositoryId: string,
): void {
  for (const wf of workflowsList) {
    addNode({
      id: stableNodeId("ci_workflow", repositoryId, wf.githubId),
      type: "ci_workflow",
      label: wf.name ?? wf.githubId,
      metadata: {
        githubId: wf.githubId,
        name: wf.name,
        path: wf.path,
        state: wf.state,
        badgeUrl: wf.badgeUrl,
        htmlUrl: wf.htmlUrl,
      },
    });
  }
}

function buildRunNodes(
  runsList: Awaited<ReturnType<typeof loadRuns>>,
  addNode: (node: GraphNode) => void,
  repositoryId: string,
): void {
  for (const run of runsList) {
    addNode({
      id: stableNodeId("ci_run", repositoryId, run.githubId),
      type: "ci_run",
      label: `${run.name ?? "Workflow"} #${run.runNumber ?? run.githubId}`,
      metadata: {
        githubId: run.githubId,
        runNumber: run.runNumber,
        name: run.name,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        headBranch: run.headBranch,
        headSha: run.headSha,
        runAttempt: run.runAttempt,
        actorLogin: run.actorLogin,
        prNumbers: run.prNumbers,
        htmlUrl: run.htmlUrl,
        durationSec: run.durationSec,
        githubCreatedAt: run.githubCreatedAt?.toISOString() ?? null,
        githubUpdatedAt: run.githubUpdatedAt?.toISOString() ?? null,
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
      },
    });
  }
}

function buildRiskNodes(
  findings: Awaited<ReturnType<typeof getRiskReport>>["findings"],
  addNode: (node: GraphNode) => void,
  repositoryId: string,
): void {
  for (const finding of findings) {
    addNode({
      id: stableNodeId("risk", repositoryId, finding.id),
      type: "risk",
      label: `${finding.severity}: ${finding.title}`,
      metadata: {
        id: finding.id,
        type: finding.type,
        severity: finding.severity,
        summary: finding.summary,
        affectedFiles: finding.affectedFiles,
        affectedContributors: finding.affectedContributors,
        recommendation: finding.recommendation,
      },
    });
  }
}

function buildIncidentNodes(
  incidentList: Awaited<ReturnType<typeof detectIncidents>>,
  addNode: (node: GraphNode) => void,
  repositoryId: string,
): void {
  for (const incident of incidentList) {
    addNode({
      id: stableNodeId("incident", repositoryId, incident.fingerprint),
      type: "incident",
      label: incident.title,
      metadata: {
        fingerprint: incident.fingerprint,
        status: incident.status,
        severity: incident.severity,
        confidence: incident.confidence,
        workflowGithubId: incident.workflowGithubId,
        workflowName: incident.workflowName,
        branch: incident.branch,
        burstLength: incident.burstLength,
        burstStartAt: incident.burstStartAt?.toISOString() ?? null,
        burstEndAt: incident.burstEndAt?.toISOString() ?? null,
        recoveryRunGithubId: incident.recoveryRunGithubId,
        recoveryAt: incident.recoveryAt?.toISOString() ?? null,
        summary: incident.summary,
        linkedPrNumbers: incident.linkedPrNumbers,
        linkedIssueNumbers: incident.linkedIssueNumbers,
        filePaths: incident.filePaths,
        riskFindingIds: incident.riskFindingIds,
        contributorLogins: incident.contributorLogins,
        unknowns: incident.unknowns,
      },
    });
  }
}

function buildRepositoryEdges(
  repo: Awaited<ReturnType<typeof getRepositoryById>>,
  nodes: Map<string, GraphNode>,
  _addEdge: (edge: GraphEdge) => void,
  repositoryId: string,
): void {
  const repoNodeId = stableNodeId("repository", repositoryId, repo.id);
  if (!nodes.has(repoNodeId)) return;

  // The repository is the root - no edges needed from it in this model
  // Other entities will link back to it via "has" edges
}

function buildCommitEdges(
  commitsList: Awaited<ReturnType<typeof loadCommits>>,
  nodes: Map<string, GraphNode>,
  addEdge: (edge: GraphEdge) => void,
  repositoryId: string,
): void {
  const repoNodeId = stableNodeId("repository", repositoryId, repositoryId);

  for (const c of commitsList) {
    const commitNodeId = stableNodeId("commit", repositoryId, c.sha);
    if (!nodes.has(commitNodeId)) continue;

    // Repository -> Commit (has)
    addEdge({
      id: makeEdgeId(repoNodeId, commitNodeId, "has"),
      sourceId: repoNodeId,
      targetId: commitNodeId,
      type: "has",
      evidenceIds: [`commit:${c.sha}`],
      provenance: {
        source: "commits.repositoryId",
        reason: "Commit belongs to this repository",
      },
    });

    // Commit -> Contributor (authored_by)
    if (c.contributorId) {
      // We need to find the contributor by their login
      // For now, we'll use authorLogin as the identifier
      if (c.authorLogin) {
        const contributorNodeId = stableNodeId("contributor", repositoryId, c.authorLogin);
        if (nodes.has(contributorNodeId)) {
          addEdge({
            id: makeEdgeId(commitNodeId, contributorNodeId, "authored_by"),
            sourceId: commitNodeId,
            targetId: contributorNodeId,
            type: "authored_by",
            evidenceIds: [`commit:${c.sha}`],
            provenance: {
              source: "commits.authorLogin / commits.contributorId",
              reason: "Commit authored by contributor",
            },
          });
        }
      }
    }
  }
}

function buildFileEdges(
  filesList: Awaited<ReturnType<typeof loadFiles>>,
  _commitFiles: typeof commitFiles,
  nodes: Map<string, GraphNode>,
  addEdge: (edge: GraphEdge) => void,
  repositoryId: string,
): void {
  // Repository -> File (contains)
  const repoNodeId = stableNodeId("repository", repositoryId, repositoryId);
  if (!nodes.has(repoNodeId)) return;

  for (const f of filesList) {
    const fileNodeId = stableNodeId("file", repositoryId, f.path);
    if (!nodes.has(fileNodeId)) continue;

    addEdge({
      id: makeEdgeId(repoNodeId, fileNodeId, "contains"),
      sourceId: repoNodeId,
      targetId: fileNodeId,
      type: "contains",
      evidenceIds: [`file:${f.path}`],
      provenance: {
        source: "files.repositoryId",
        reason: "File exists in this repository",
      },
    });
  }
}

function buildContributorEdges(
  contributorsList: Awaited<ReturnType<typeof loadContributors>>,
  commitsList: Awaited<ReturnType<typeof loadCommits>>,
  nodes: Map<string, GraphNode>,
  addEdge: (edge: GraphEdge) => void,
  repositoryId: string,
): void {
  const repoNodeId = stableNodeId("repository", repositoryId, repositoryId);

  // Build a map of contributor login -> commit count for evidence
  const contributorCommitCounts = new Map<string, number>();
  for (const c of commitsList) {
    if (c.authorLogin) {
      contributorCommitCounts.set(
        c.authorLogin,
        (contributorCommitCounts.get(c.authorLogin) ?? 0) + 1,
      );
    }
  }

  for (const contr of contributorsList) {
    const contrNodeId = stableNodeId("contributor", repositoryId, contr.login);
    if (!nodes.has(contrNodeId)) continue;

    // Repository -> Contributor (has)
    addEdge({
      id: makeEdgeId(repoNodeId, contrNodeId, "has"),
      sourceId: repoNodeId,
      targetId: contrNodeId,
      type: "has",
      evidenceIds: [`contributor:${contr.login}`],
      provenance: {
        source: "contributors.repositoryId",
        reason: "Contributor has commits in this repository",
      },
    });
  }
}

function buildPrEdges(
  prsList: Awaited<ReturnType<typeof loadPullRequests>>,
  nodes: Map<string, GraphNode>,
  addEdge: (edge: GraphEdge) => void,
  repositoryId: string,
  prFilesList: Awaited<ReturnType<typeof loadPrFiles>>,
  prCommitsList: Awaited<ReturnType<typeof loadPrCommits>>,
): void {
  const repoNodeId = stableNodeId("repository", repositoryId, repositoryId);

  const prFilesByPr = new Map<string, typeof prFilesList>();
  for (const pf of prFilesList) {
    const list = prFilesByPr.get(pf.pullRequestId) ?? [];
    list.push(pf);
    prFilesByPr.set(pf.pullRequestId, list);
  }

  const prCommitsByPr = new Map<string, typeof prCommitsList>();
  for (const pc of prCommitsList) {
    const list = prCommitsByPr.get(pc.pullRequestId) ?? [];
    list.push(pc);
    prCommitsByPr.set(pc.pullRequestId, list);
  }

  for (const pr of prsList) {
    const prNodeId = stableNodeId("pull_request", repositoryId, String(pr.number));
    if (!nodes.has(prNodeId)) continue;

    // Repository -> PR (has)
    addEdge({
      id: makeEdgeId(repoNodeId, prNodeId, "has"),
      sourceId: repoNodeId,
      targetId: prNodeId,
      type: "has",
      evidenceIds: [`pr:${pr.number}`],
      provenance: {
        source: "pullRequests.repositoryId",
        reason: "Pull request belongs to this repository",
      },
    });

    // PR -> Commits (contains_commit) via prCommits table
    const prCommitRows = prCommitsByPr.get(pr.id) ?? [];
    for (const pc of prCommitRows) {
      const commitNodeId = stableNodeId("commit", repositoryId, pc.commitId);
      if (nodes.has(commitNodeId)) {
        addEdge({
          id: makeEdgeId(prNodeId, commitNodeId, "contains_commit"),
          sourceId: prNodeId,
          targetId: commitNodeId,
          type: "contains_commit",
          evidenceIds: [`pr:${pr.number}`, `commit:${pc.commitId}`],
          provenance: {
            source: "pr_commits",
            reason: "PR contains this commit",
          },
        });
      }
    }

    // PR -> Files (affects) via prFiles table
    const prFileRows = prFilesByPr.get(pr.id) ?? [];
    for (const pf of prFileRows) {
      const fileNodeId = stableNodeId("file", repositoryId, pf.path);
      if (nodes.has(fileNodeId)) {
        addEdge({
          id: makeEdgeId(prNodeId, fileNodeId, "affects"),
          sourceId: prNodeId,
          targetId: fileNodeId,
          type: "affects",
          evidenceIds: [`pr:${pr.number}`, `file:${pf.path}`],
          provenance: {
            source: "pr_files",
            reason: `PR modifies this file (${pf.status ?? "changed"}, +${pf.additions ?? 0}/-${pf.deletions ?? 0})`,
          },
        });
      }
    }
  }
}

function buildIssueEdges(
  issuesList: Awaited<ReturnType<typeof loadIssues>>,
  nodes: Map<string, GraphNode>,
  addEdge: (edge: GraphEdge) => void,
  repositoryId: string,
): void {
  const repoNodeId = stableNodeId("repository", repositoryId, repositoryId);

  for (const issue of issuesList) {
    const issueNodeId = stableNodeId("issue", repositoryId, String(issue.number));
    if (!nodes.has(issueNodeId)) continue;

    // Repository -> Issue (has)
    addEdge({
      id: makeEdgeId(repoNodeId, issueNodeId, "has"),
      sourceId: repoNodeId,
      targetId: issueNodeId,
      type: "has",
      evidenceIds: [`issue:${issue.number}`],
      provenance: {
        source: "issues.repositoryId",
        reason: "Issue belongs to this repository",
      },
    });
  }
}

function buildWorkflowEdges(
  workflowsList: Awaited<ReturnType<typeof loadWorkflows>>,
  nodes: Map<string, GraphNode>,
  addEdge: (edge: GraphEdge) => void,
  repositoryId: string,
): void {
  const repoNodeId = stableNodeId("repository", repositoryId, repositoryId);

  for (const wf of workflowsList) {
    const wfNodeId = stableNodeId("ci_workflow", repositoryId, wf.githubId);
    if (!nodes.has(wfNodeId)) continue;

    // Repository -> Workflow (has)
    addEdge({
      id: makeEdgeId(repoNodeId, wfNodeId, "has"),
      sourceId: repoNodeId,
      targetId: wfNodeId,
      type: "has",
      evidenceIds: [`workflow:${wf.githubId}`],
      provenance: {
        source: "ciWorkflows.repositoryId",
        reason: "Workflow belongs to this repository",
      },
    });
  }
}

function buildRunEdges(
  runsList: Awaited<ReturnType<typeof loadRuns>>,
  nodes: Map<string, GraphNode>,
  addEdge: (edge: GraphEdge) => void,
  repositoryId: string,
  workflowsList: Awaited<ReturnType<typeof loadWorkflows>>,
): void {
  const workflowNodeById = new Map(
    workflowsList.map((wf) => [wf.id, stableNodeId("ci_workflow", repositoryId, wf.githubId)]),
  );

  for (const run of runsList) {
    const runNodeId = stableNodeId("ci_run", repositoryId, run.githubId);
    if (!nodes.has(runNodeId)) continue;

    // Workflow -> Run (belongs_to)
    const wfNodeId = workflowNodeById.get(run.workflowId);
    if (wfNodeId && nodes.has(wfNodeId)) {
      addEdge({
        id: makeEdgeId(wfNodeId, runNodeId, "belongs_to"),
        sourceId: wfNodeId,
        targetId: runNodeId,
        type: "belongs_to",
        evidenceIds: [`run:${run.githubId}`, `workflow:${run.workflowId}`],
        provenance: {
          source: "ciRuns.workflowId",
          reason: "Run belongs to workflow",
        },
      });
    }

    // Run -> Commit (executes_on)
    if (run.headSha) {
      const commitNodeId = stableNodeId("commit", repositoryId, run.headSha);
      if (nodes.has(commitNodeId)) {
        addEdge({
          id: makeEdgeId(runNodeId, commitNodeId, "executes_on"),
          sourceId: runNodeId,
          targetId: commitNodeId,
          type: "executes_on",
          evidenceIds: [`run:${run.githubId}`, `commit:${run.headSha}`],
          provenance: {
            source: "ciRuns.headSha",
            reason: "Run executes on this commit",
          },
        });
      }
    }

    // Run -> PR (triggers) - via prNumbers
    if (run.prNumbers && run.prNumbers.length > 0) {
      for (const prNum of run.prNumbers) {
        const prNodeId = stableNodeId("pull_request", repositoryId, String(prNum));
        if (nodes.has(prNodeId)) {
          addEdge({
            id: makeEdgeId(runNodeId, prNodeId, "triggers"),
            sourceId: runNodeId,
            targetId: prNodeId,
            type: "triggers",
            evidenceIds: [`run:${run.githubId}`, `pr:${prNum}`],
            provenance: {
              source: "ciRuns.prNumbers",
              reason: "Run associated with PR via GitHub",
            },
          });
        }
      }
    }
  }
}

function buildRiskEdges(
  findings: Awaited<ReturnType<typeof getRiskReport>>["findings"],
  nodes: Map<string, GraphNode>,
  addEdge: (edge: GraphEdge) => void,
  repositoryId: string,
): void {
  const repoNodeId = stableNodeId("repository", repositoryId, repositoryId);

  for (const finding of findings) {
    const riskNodeId = stableNodeId("risk", repositoryId, finding.id);
    if (!nodes.has(riskNodeId)) continue;

    // Repository -> Risk (has)
    addEdge({
      id: makeEdgeId(repoNodeId, riskNodeId, "has"),
      sourceId: repoNodeId,
      targetId: riskNodeId,
      type: "has",
      evidenceIds: [`risk:${finding.id}`],
      provenance: {
        source: "risk report",
        reason: "Risk finding detected in this repository",
      },
    });

    // Risk -> File (affects_file)
    for (const filePath of finding.affectedFiles) {
      const fileNodeId = stableNodeId("file", repositoryId, filePath);
      if (nodes.has(fileNodeId)) {
        addEdge({
          id: makeEdgeId(riskNodeId, fileNodeId, "affects_file"),
          sourceId: riskNodeId,
          targetId: fileNodeId,
          type: "affects_file",
          evidenceIds: [`risk:${finding.id}`, `file:${filePath}`],
          provenance: {
            source: "risk finding affectedFiles",
            reason: "Risk affects this file",
          },
        });
      }
    }

    // Risk -> Contributor (associated_with)
    for (const login of finding.affectedContributors) {
      const contrNodeId = stableNodeId("contributor", repositoryId, login);
      if (nodes.has(contrNodeId)) {
        addEdge({
          id: makeEdgeId(riskNodeId, contrNodeId, "associated_with"),
          sourceId: riskNodeId,
          targetId: contrNodeId,
          type: "associated_with",
          evidenceIds: [`risk:${finding.id}`, `contributor:${login}`],
          provenance: {
            source: "risk finding affectedContributors",
            reason: "Risk associated with contributor's changes",
          },
        });
      }
    }
  }
}

function buildIncidentEdges(
  incidentList: Awaited<ReturnType<typeof detectIncidents>>,
  nodes: Map<string, GraphNode>,
  addEdge: (edge: GraphEdge) => void,
  repositoryId: string,
): void {
  const repoNodeId = stableNodeId("repository", repositoryId, repositoryId);

  for (const incident of incidentList) {
    const incidentNodeId = stableNodeId("incident", repositoryId, incident.fingerprint);
    if (!nodes.has(incidentNodeId)) continue;

    // Repository -> Incident (has)
    addEdge({
      id: makeEdgeId(repoNodeId, incidentNodeId, "has"),
      sourceId: repoNodeId,
      targetId: incidentNodeId,
      type: "has",
      evidenceIds: [`incident:${incident.fingerprint}`],
      provenance: {
        source: "incident detection",
        reason: "Incident detected in this repository",
      },
    });

    // Incident -> Workflow (relates_to)
    const wfNodeId = stableNodeId("ci_workflow", repositoryId, incident.workflowGithubId);
    if (nodes.has(wfNodeId)) {
      addEdge({
        id: makeEdgeId(incidentNodeId, wfNodeId, "relates_to"),
        sourceId: incidentNodeId,
        targetId: wfNodeId,
        type: "relates_to",
        evidenceIds: [`incident:${incident.fingerprint}`, `workflow:${incident.workflowGithubId}`],
        provenance: {
          source: "incident.workflowGithubId",
          reason: "Incident detected in this workflow",
        },
      });
    }

    // Incident -> Run (composed_of)
    for (const evidence of incident.evidence) {
      if (evidence.kind === "run") {
        const runNodeId = stableNodeId("ci_run", repositoryId, evidence.value);
        if (nodes.has(runNodeId)) {
          addEdge({
            id: makeEdgeId(incidentNodeId, runNodeId, "composed_of"),
            sourceId: incidentNodeId,
            targetId: runNodeId,
            type: "composed_of",
            evidenceIds: [`incident:${incident.fingerprint}`, `run:${evidence.value}`],
            provenance: {
              source: "incident evidence",
              reason: "Incident includes this CI run",
            },
          });
        }
      }
    }

    // Incident -> Commit (relates_to)
    for (const evidence of incident.evidence) {
      if (evidence.kind === "commit") {
        const commitNodeId = stableNodeId("commit", repositoryId, evidence.value);
        if (nodes.has(commitNodeId)) {
          addEdge({
            id: makeEdgeId(incidentNodeId, commitNodeId, "relates_to"),
            sourceId: incidentNodeId,
            targetId: commitNodeId,
            type: "relates_to",
            evidenceIds: [`incident:${incident.fingerprint}`, `commit:${evidence.value}`],
            provenance: {
              source: "incident evidence",
              reason: "Incident includes this commit",
            },
          });
        }
      }
    }

    // Incident -> PR (relates_to)
    for (const evidence of incident.evidence) {
      if (evidence.kind === "pr") {
        const prNodeId = stableNodeId("pull_request", repositoryId, evidence.value);
        if (nodes.has(prNodeId)) {
          addEdge({
            id: makeEdgeId(incidentNodeId, prNodeId, "relates_to"),
            sourceId: incidentNodeId,
            targetId: prNodeId,
            type: "relates_to",
            evidenceIds: [`incident:${incident.fingerprint}`, `pr:${evidence.value}`],
            provenance: {
              source: "incident evidence",
              reason: "Incident linked to this PR",
            },
          });
        }
      }
    }

    // Incident -> Issue (relates_to)
    for (const evidence of incident.evidence) {
      if (evidence.kind === "issue") {
        const issueNodeId = stableNodeId("issue", repositoryId, evidence.value);
        if (nodes.has(issueNodeId)) {
          addEdge({
            id: makeEdgeId(incidentNodeId, issueNodeId, "relates_to"),
            sourceId: incidentNodeId,
            targetId: issueNodeId,
            type: "relates_to",
            evidenceIds: [`incident:${incident.fingerprint}`, `issue:${evidence.value}`],
            provenance: {
              source: "incident evidence",
              reason: "Incident linked to this issue",
            },
          });
        }
      }
    }

    // Incident -> File (relates_to)
    for (const evidence of incident.evidence) {
      if (evidence.kind === "file") {
        const fileNodeId = stableNodeId("file", repositoryId, evidence.value);
        if (nodes.has(fileNodeId)) {
          addEdge({
            id: makeEdgeId(incidentNodeId, fileNodeId, "relates_to"),
            sourceId: incidentNodeId,
            targetId: fileNodeId,
            type: "relates_to",
            evidenceIds: [`incident:${incident.fingerprint}`, `file:${evidence.value}`],
            provenance: {
              source: "incident evidence",
              reason: "Incident involves this file",
            },
          });
        }
      }
    }

    // Incident -> Risk (relates_to)
    for (const evidence of incident.evidence) {
      if (evidence.kind === "risk") {
        const riskNodeId = stableNodeId("risk", repositoryId, evidence.value);
        if (nodes.has(riskNodeId)) {
          addEdge({
            id: makeEdgeId(incidentNodeId, riskNodeId, "relates_to"),
            sourceId: incidentNodeId,
            targetId: riskNodeId,
            type: "relates_to",
            evidenceIds: [`incident:${incident.fingerprint}`, `risk:${evidence.value}`],
            provenance: {
              source: "incident evidence",
              reason: "Incident overlaps with this risk finding",
            },
          });
        }
      }
    }
  }
}