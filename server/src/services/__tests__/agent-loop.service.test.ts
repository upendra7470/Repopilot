import { describe, it, expect } from "vitest";
import {
  planAgentTools,
  AGENT_SYSTEM_ADDENDUM,
} from "../agent-loop.service.js";
import { executeAgentTool } from "../agent-tools.service.js";
import type { AskEntityRef } from "../ask.service.js";

function entity(kind: AskEntityRef["kind"], value: string): AskEntityRef {
  return { kind, value, label: `${kind}:${value}` };
}

describe("planAgentTools", () => {
  it("starts scoped investigations with investigate_entity", () => {
    const plan = planAgentTools("incidents", [], {
      entityType: "incident",
      entityId: "abc123",
    });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0].tool).toBe("investigate_entity");
    expect(plan[0].args).toMatchObject({ entityType: "incident", entityId: "abc123" });
  });

  it("plans a CI timeline for ci_cd intent", () => {
    const plan = planAgentTools("ci_cd", [], null);
    expect(plan.some((s) => s.tool === "get_ci_timeline")).toBe(true);
  });

  it("plans file context and risk check for file questions", () => {
    const plan = planAgentTools("files", [entity("file", "src/auth/token.ts")], null);
    expect(plan.some((s) => s.tool === "get_file_context")).toBe(true);
    expect(plan.some((s) => s.tool === "check_risk_patterns")).toBe(true);
  });

  it("falls back to a graph sweep when nothing else applies", () => {
    const plan = planAgentTools("overview", [], null);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0].tool).toBe("query_knowledge_graph");
  });

  it("bounds the plan to at most 5 steps without duplicates", () => {
    const plan = planAgentTools(
      "cross_domain_investigation",
      [entity("file", "src/a.ts"), entity("run", "run-1")],
      { entityType: "incident", entityId: "fp" },
    );
    expect(plan.length).toBeLessThanOrEqual(5);
    const keys = plan.map((s) => `${s.tool}:${JSON.stringify(s.args)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the structured-output addendum provider-agnostic", () => {
    expect(AGENT_SYSTEM_ADDENDUM).toContain("JSON");
    expect(AGENT_SYSTEM_ADDENDUM).toContain("evidence IDs");
  });
});

describe("executeAgentTool", () => {
  it("skips unsupported entity types without throwing", async () => {
    const result = await executeAgentTool(
      "00000000-0000-0000-0000-000000000000",
      "investigate_entity",
      { entityType: "nonsense", entityId: "x" },
      "Trying an unsupported entity.",
    );
    expect(result.tool).toBe("investigate_entity");
    expect(result.evidenceIds).toEqual([]);
    expect(result.summary).toContain("skipped");
    expect(typeof result.durationMs).toBe("number");
  });

  it("captures tool failures as results instead of throwing", async () => {
    const result = await executeAgentTool(
      "00000000-0000-0000-0000-000000000000",
      "get_file_context",
      {},
      "No path provided.",
    );
    expect(result.summary).toContain("no path");
    expect(result.evidenceIds).toEqual([]);
  });
});
