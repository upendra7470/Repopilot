import { getLogger } from "../utils/logger.js";
import {
  executeAgentTool,
  type AgentToolName,
} from "./agent-tools.service.js";
import type {
  AskEntityRef,
  AskIntent,
  AskResult,
} from "./ask.service.js";

/**
 * Agentic loop (Cline-for-GitHub upgrade).
 *
 * Pipeline: User Prompt → Intent & Scope Analysis (deterministic, done by
 * ask.service) → Autonomous Tool Executions → Deterministic Context
 * Consolidation → Reasoning & Verification (LLM over the consolidated
 * package in ask-analysis.service) → Actionable Response + Evidence.
 *
 * Planning is deterministic and heuristic (no provider function-calling
 * APIs required), so the loop works identically across OpenRouter, Ollama,
 * LM Studio, and custom OpenAI-compatible endpoints. The LLM only ever
 * reasons over the consolidated deterministic context.
 */

export interface AgentPlanStep {
  tool: AgentToolName;
  args: Record<string, string>;
  thought: string;
}

export interface AgentStep extends AgentPlanStep {
  step: number;
  summary: string;
  evidenceIds: string[];
  durationMs: number;
}

export interface AgentRunResult {
  mode: "agentic" | "cached" | "deterministic-only";
  steps: AgentStep[];
  toolEvidenceIds: string[];
  /** Compact consolidation appended to the LLM prompt. */
  agentContext: string;
}

const MAX_TOOL_STEPS = 5;

/** Provider-agnostic system addendum enforcing structured output. */
export const AGENT_SYSTEM_ADDENDUM = [
  "AGENT MODE: you are reasoning over a deterministically assembled tool-trace.",
  "Each TOOL line below is a verified backend observation — treat it as authoritative.",
  "Every factual claim MUST cite evidence IDs from the Evidence Package or TOOL lines.",
  "Do not invent tool results, commits, files, PRs, issues, runs, or relationships.",
  "Output MUST be a single JSON object per the required schema (no markdown fences).",
  "If the tool trace is thin or empty, say so explicitly in unknowns.",
].join("\n");

/**
 * Deterministic planner: intent + entity scope → bounded tool sequence.
 * Scoped-entity investigations always start with investigate_entity.
 */
export function planAgentTools(
  intent: AskIntent,
  entities: AskEntityRef[],
  context?: { entityType: string; entityId: string } | null,
): AgentPlanStep[] {
  const plan: AgentPlanStep[] = [];
  const seen = new Set<string>();
  const push = (step: AgentPlanStep): void => {
    const key = `${step.tool}:${JSON.stringify(step.args)}`;
    if (!seen.has(key) && plan.length < MAX_TOOL_STEPS) {
      seen.add(key);
      plan.push(step);
    }
  };

  const resolvedFiles = entities.filter((e) => e.kind === "file" && !e.unresolved && !e.ambiguous);
  const resolvedRuns = entities.filter((e) => e.kind === "run" && !e.unresolved && !e.ambiguous);

  if (context?.entityType && context?.entityId) {
    push({
      tool: "investigate_entity",
      args: { entityType: context.entityType, entityId: context.entityId },
      thought: `Investigating scoped entity ${context.entityType}:${context.entityId}.`,
    });
  }

  switch (intent) {
    case "ci_cd":
    case "incidents":
      push({
        tool: "get_ci_timeline",
        args: {},
        thought: "Checking CI timeline for failures and streaks.",
      });
      break;
    case "risks":
      push({
        tool: "check_risk_patterns",
        args: resolvedFiles[0] ? { path: resolvedFiles[0].value } : {},
        thought: resolvedFiles[0]
          ? `Checking risk patterns overlapping ${resolvedFiles[0].value}.`
          : "Checking repository-wide risk patterns.",
      });
      break;
    case "files":
      if (resolvedFiles[0]) {
        push({
          tool: "get_file_context",
          args: { path: resolvedFiles[0].value },
          thought: `Examining change history for ${resolvedFiles[0].value}.`,
        });
      }
      push({
        tool: "check_risk_patterns",
        args: resolvedFiles[0] ? { path: resolvedFiles[0].value } : {},
        thought: "Checking whether these files carry known risk findings.",
      });
      break;
    case "relationships":
    case "cross_domain_investigation":
      push({
        tool: "query_knowledge_graph",
        args:
          context?.entityType && context?.entityId
            ? { entityType: context.entityType, entityId: context.entityId, depth: "2" }
            : { depth: "2" },
        thought: "Searching the knowledge graph for cross-domain relationships.",
      });
      break;
    case "pull_requests":
    case "issues":
    case "timeline":
    case "recent_changes":
    case "contributors":
    case "overview":
    case "engineering_brief":
    case "unknown":
      break;
  }

  // Follow-ups: entity-grounded expansion (bounded, deduplicated).
  if (resolvedRuns[0] && intent !== "ci_cd" && intent !== "incidents") {
    push({
      tool: "get_ci_timeline",
      args: {},
      thought: "Question references a CI run — checking the surrounding timeline.",
    });
  }
  if (resolvedFiles[0] && intent !== "files" && intent !== "risks") {
    push({
      tool: "get_file_context",
      args: { path: resolvedFiles[0].value },
      thought: `Examining change history for ${resolvedFiles[0].value}.`,
    });
  }

  // Default: unscoped questions get a shallow graph sweep so the agent
  // always has structural context beyond the flat evidence list.
  if (plan.length === 0) {
    push({
      tool: "query_knowledge_graph",
      args: { depth: "1" },
      thought: "Searching the knowledge graph for structural context.",
    });
  }

  return plan;
}

/**
 * Execute the planned tools sequentially and consolidate their outputs.
 * Never throws: an empty plan or total tool failure yields a
 * deterministic-only result the caller can still serve.
 */
export async function runAgentLoop(
  repositoryId: string,
  deterministic: AskResult,
  context?: { entityType: string; entityId: string } | null,
  prebuiltSteps?: AgentStep[],
): Promise<AgentRunResult> {
  const logger = getLogger();
  const started = Date.now();

  if (prebuiltSteps) {
    const toolEvidenceIds = [...new Set(prebuiltSteps.flatMap((s) => s.evidenceIds))];
    return {
      mode: "cached",
      steps: prebuiltSteps,
      toolEvidenceIds,
      agentContext: buildAgentContext(prebuiltSteps),
    };
  }

  const plan = planAgentTools(deterministic.intent, deterministic.entities, context);
  const steps: AgentStep[] = [];

  for (let i = 0; i < plan.length; i += 1) {
    const item = plan[i];
    const result = await executeAgentTool(repositoryId, item.tool, item.args, item.thought);
    steps.push({
      step: i + 1,
      tool: result.tool,
      args: item.args,
      thought: result.thought,
      summary: result.summary,
      evidenceIds: result.evidenceIds,
      durationMs: result.durationMs,
    });
  }

  const toolEvidenceIds = [...new Set(steps.flatMap((s) => s.evidenceIds))];
  logger.debug(
    { repositoryId, intent: deterministic.intent, steps: steps.length, durationMs: Date.now() - started },
    "Agent loop completed",
  );

  return {
    mode: "agentic",
    steps,
    toolEvidenceIds,
    agentContext: buildAgentContext(steps),
  };
}

function buildAgentContext(steps: AgentStep[]): string {
  if (steps.length === 0) return "";
  const lines = ["Agent Tool Trace (deterministic backend observations):"];
  for (const s of steps) {
    lines.push(`STEP ${s.step} [${s.tool}] ${s.thought}`);
    lines.push(`  → ${s.summary}`);
    if (s.evidenceIds.length > 0) {
      lines.push(`  evidence: ${s.evidenceIds.slice(0, 15).join(", ")}`);
    }
  }
  return lines.join("\n");
}
