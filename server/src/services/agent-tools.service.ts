import { getLogger } from "../utils/logger.js";
import {
  buildInvestigationContext,
  normalizeInvestigationType,
} from "./investigation.service.js";
import { buildGraph } from "./graph.service.js";
import {
  getFileHistory,
  listRepositoryFiles,
} from "./memory.service.js";
import { getCiSummary, getRunDetail } from "./ci-intelligence.service.js";
import { analyzeRepositoryRisks } from "./risk.service.js";

/**
 * Agentic tool layer (Cline-for-GitHub upgrade).
 *
 * Each tool is a thin, bounded wrapper around an existing deterministic
 * engine. Tools never invent facts: they query PostgreSQL-backed services
 * and return canonical evidence IDs alongside a short human-readable
 * summary for the agent trace. All executions are scoped to a single
 * repositoryId (enforced by callers via requireRepositoryAccess).
 */

export type AgentToolName =
  | "investigate_entity"
  | "query_knowledge_graph"
  | "get_file_context"
  | "get_ci_timeline"
  | "check_risk_patterns";

export const AGENT_TOOLS: Record<
  AgentToolName,
  { description: string; args: string[] }
> = {
  investigate_entity: {
    description:
      "Build structured investigation context for one entity (commit, pr, issue, run, workflow, incident, risk, file).",
    args: ["entityType", "entityId"],
  },
  query_knowledge_graph: {
    description:
      "Fetch multi-depth knowledge-graph nodes and edges around an optional root entity.",
    args: ["entityType?", "entityId?", "depth?"],
  },
  get_file_context: {
    description:
      "Examine a file's change history and recent commits touching its area.",
    args: ["path"],
  },
  get_ci_timeline: {
    description:
      "Retrieve workflow run failures, streaks, and recent run conclusions.",
    args: ["workflow?", "branch?"],
  },
  check_risk_patterns: {
    description: "Fetch deterministic risk findings overlapping files or areas.",
    args: ["path?"],
  },
};

export interface AgentToolResult {
  tool: AgentToolName;
  thought: string;
  summary: string;
  evidenceIds: string[];
  durationMs: number;
}

function canonicalId(kind: string, value: string): string {
  return `${kind}:${value}`;
}

async function toolInvestigateEntity(
  repositoryId: string,
  args: Record<string, string>,
): Promise<Omit<AgentToolResult, "tool" | "thought" | "durationMs">> {
  const rawType = args.entityType ?? "";
  const entityId = args.entityId ?? "";
  const normalized = normalizeInvestigationType(rawType);
  if (!normalized || !entityId) {
    return {
      summary: `investigate_entity skipped: unsupported entity ${rawType}:${entityId}.`,
      evidenceIds: [],
    };
  }
  const ctx = await buildInvestigationContext(repositoryId, {
    type: normalized,
    identifier: entityId,
  });
  const evidenceIds: string[] = [];
  for (const c of ctx.evidence.commits.slice(0, 10)) {
    evidenceIds.push(canonicalId("commit", c.shortSha));
  }
  for (const p of ctx.evidence.prs.slice(0, 10)) {
    evidenceIds.push(canonicalId("pr", String(p.number)));
  }
  for (const i of ctx.evidence.issues.slice(0, 10)) {
    evidenceIds.push(canonicalId("issue", String(i.number)));
  }
  for (const r of ctx.evidence.runs.slice(0, 10)) {
    evidenceIds.push(canonicalId("run", r.githubId));
  }
  for (const f of ctx.evidence.files.slice(0, 10)) {
    evidenceIds.push(canonicalId("file", f.path));
  }
  for (const r of ctx.evidence.risks.slice(0, 5)) {
    evidenceIds.push(canonicalId("risk", r.id));
  }
  for (const i of ctx.evidence.incidents.slice(0, 5)) {
    evidenceIds.push(canonicalId("incident", i.fingerprint));
  }
  const total =
    ctx.evidence.commits.length +
    ctx.evidence.files.length +
    ctx.evidence.prs.length +
    ctx.evidence.issues.length +
    ctx.evidence.runs.length +
    ctx.evidence.risks.length +
    ctx.evidence.incidents.length;
  return {
    summary:
      `Investigated ${normalized}:${entityId}: ${total} related records ` +
      `(${ctx.directRelationships.commits.length} commits, ${ctx.directRelationships.files.length} files, ` +
      `${ctx.directRelationships.prs.length} PRs, ${ctx.directRelationships.runs.length} runs, ` +
      `${ctx.directRelationships.risks.length} risks, ${ctx.directRelationships.incidents.length} incidents).`,
    evidenceIds,
  };
}

async function toolQueryKnowledgeGraph(
  repositoryId: string,
  args: Record<string, string>,
): Promise<Omit<AgentToolResult, "tool" | "thought" | "durationMs">> {
  const depth = Math.min(Math.max(parseInt(args.depth ?? "2", 10) || 2, 1), 3);
  const graph = await buildGraph(repositoryId, {
    entityType: args.entityType || undefined,
    entityId: args.entityId || undefined,
    depth,
    limit: 200,
  });
  const evidenceIds = graph.nodes.slice(0, 20).map((n) => {
    const idPart = n.id.split(":").slice(-1)[0] ?? n.id;
    const kind =
      n.type === "pull_request"
        ? "pr"
        : n.type === "ci_run"
          ? "run"
          : n.type === "ci_workflow"
            ? "workflow"
            : n.type;
    return canonicalId(kind, idPart);
  });
  const root =
    args.entityType && args.entityId
      ? ` around ${args.entityType}:${args.entityId}`
      : "";
  return {
    summary:
      `Knowledge graph${root} (depth ${graph.meta.depth}): ` +
      `${graph.meta.nodeCount} nodes, ${graph.meta.edgeCount} edges` +
      `${graph.meta.truncated ? " (truncated)" : ""}.`,
    evidenceIds,
  };
}

async function toolGetFileContext(
  repositoryId: string,
  args: Record<string, string>,
): Promise<Omit<AgentToolResult, "tool" | "thought" | "durationMs">> {
  const path = (args.path ?? "").trim();
  if (!path) {
    return { summary: "get_file_context skipped: no path provided.", evidenceIds: [] };
  }
  const files = await listRepositoryFiles(repositoryId, { prefix: path, limit: 20 });
  const exact =
    files.find((f) => f.path === path) ??
    files.find((f) => f.path.endsWith(`/${path}`));
  if (!exact) {
    return {
      summary: `No synced record for file path "${path}".`,
      evidenceIds: [],
    };
  }
  const history = await getFileHistory(repositoryId, exact.id);
  if (!history) {
    return {
      summary: `File "${exact.path}" is synced but has no recorded history.`,
      evidenceIds: [canonicalId("file", exact.path)],
    };
  }
  const evidenceIds = [
    canonicalId("file", history.file.path),
    ...history.history.slice(0, 8).map((h) => canonicalId("commit", h.sha.slice(0, 12))),
  ];
  return {
    summary:
      `File "${history.file.path}": ${history.changeCount} recorded changes` +
      `${history.latestChange ? `, latest by ${history.latestChange.authorLogin ?? "unknown"}` : ""}.`,
    evidenceIds,
  };
}

async function toolGetCiTimeline(
  repositoryId: string,
  args: Record<string, string>,
): Promise<Omit<AgentToolResult, "tool" | "thought" | "durationMs">> {
  const summary = await getCiSummary(repositoryId);
  const branchFilter = (args.branch ?? "").trim().toLowerCase();
  const workflowFilter = (args.workflow ?? "").trim().toLowerCase();
  const failures = summary.recentFailures
    .filter((f) =>
      branchFilter ? (f.headBranch ?? "").toLowerCase() === branchFilter : true,
    )
    .filter((f) =>
      workflowFilter
        ? (f.workflowName ?? "").toLowerCase().includes(workflowFilter)
        : true,
    )
    .slice(0, 8);
  const evidenceIds = failures.map((f) => canonicalId("run", f.githubId));
  for (const s of summary.failureStreaks.slice(0, 3)) {
    evidenceIds.push(canonicalId("workflow", s.workflowGithubId));
  }
  // Enrich with the latest failure's commit link when available (bounded: 1 lookup).
  let extra = "";
  if (failures[0]) {
    const detail = await getRunDetail(repositoryId, failures[0].githubId);
    if (detail?.commit?.sha) {
      evidenceIds.push(canonicalId("commit", detail.commit.sha.slice(0, 12)));
      extra = ` Latest failure touches commit ${detail.commit.sha.slice(0, 12)}.`;
    }
  }
  return {
    summary:
      `CI timeline: ${summary.counts.failed} failures / ${summary.counts.runs} runs, ` +
      `${summary.failureStreaks.length} active failure streaks, ` +
      `${summary.recentFailures.length} recent failures observed.${extra}`,
    evidenceIds,
  };
}

async function toolCheckRiskPatterns(
  repositoryId: string,
  args: Record<string, string>,
): Promise<Omit<AgentToolResult, "tool" | "thought" | "durationMs">> {
  const report = await analyzeRepositoryRisks(repositoryId);
  const pathFilter = (args.path ?? "").trim();
  const findings = (
    pathFilter
      ? report.findings.filter((f) => f.affectedFiles.some((p) => p.includes(pathFilter)))
      : report.findings
  ).slice(0, 8);
  const evidenceIds = findings.map((f) => canonicalId("risk", f.id));
  for (const f of findings.slice(0, 3)) {
    for (const p of f.affectedFiles.slice(0, 2)) {
      if (!evidenceIds.includes(canonicalId("file", p))) {
        evidenceIds.push(canonicalId("file", p));
      }
    }
  }
  if (findings.length === 0) {
    return {
      summary: pathFilter
        ? `No risk findings overlap "${pathFilter}".`
        : "No risk findings in the current analysis window.",
      evidenceIds,
    };
  }
  const severities = findings.map((f) => f.severity).join(", ");
  return {
    summary: `${findings.length} risk findings (${severities}). Top: ${findings[0].title}.`,
    evidenceIds,
  };
}

/**
 * Execute one deterministic agent tool. Never throws: failures are
 * captured as a result with an explanatory summary so the agent trace
 * stays complete and the loop can continue.
 */
export async function executeAgentTool(
  repositoryId: string,
  tool: AgentToolName,
  args: Record<string, string>,
  thought: string,
): Promise<AgentToolResult> {
  const logger = getLogger();
  const started = Date.now();
  try {
    let partial: Omit<AgentToolResult, "tool" | "thought" | "durationMs">;
    switch (tool) {
      case "investigate_entity":
        partial = await toolInvestigateEntity(repositoryId, args);
        break;
      case "query_knowledge_graph":
        partial = await toolQueryKnowledgeGraph(repositoryId, args);
        break;
      case "get_file_context":
        partial = await toolGetFileContext(repositoryId, args);
        break;
      case "get_ci_timeline":
        partial = await toolGetCiTimeline(repositoryId, args);
        break;
      case "check_risk_patterns":
        partial = await toolCheckRiskPatterns(repositoryId, args);
        break;
      default:
        partial = { summary: `Unknown tool: ${tool}.`, evidenceIds: [] };
    }
    return {
      tool,
      thought,
      summary: partial.summary,
      evidenceIds: [...new Set(partial.evidenceIds)].slice(0, 30),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    logger.warn({ err, repositoryId, tool, args }, "Agent tool execution failed");
    return {
      tool,
      thought,
      summary: `${tool} unavailable: ${err instanceof Error ? err.message : "execution failed"}.`,
      evidenceIds: [],
      durationMs: Date.now() - started,
    };
  }
}
