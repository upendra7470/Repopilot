import type { FastifyInstance } from "fastify";
import {
  requireAuth,
  requireRepositoryAccess,
} from "../middleware/auth.js";
import {
  getEngineeringBrief,
  parseBriefWindow,
} from "../services/brief.service.js";
import {
  getLatestBriefAnalysis,
  requestBriefAnalysis,
} from "../services/brief-analysis.service.js";

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

const sectionItemSchema = {
  type: "object",
  required: ["title", "description", "entityType", "entityId", "evidenceIds"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    severity: { type: ["string", "null"] },
    entityType: { type: "string" },
    entityId: { type: "string" },
    evidenceIds: { type: "array", items: { type: "string" } },
  },
} as const;

const evidenceItemSchema = {
  type: "object",
  required: ["id", "kind", "label", "detail", "entityType", "entityId"],
  properties: {
    id: { type: "string" },
    kind: { type: "string" },
    label: { type: "string" },
    detail: { type: "string" },
    entityType: { type: "string" },
    entityId: { type: "string" },
  },
} as const;

const briefSchema = {
  type: "object",
  required: [
    "repository",
    "generatedAt",
    "window",
    "summary",
    "counts",
    "whatChanged",
    "failures",
    "incidents",
    "risks",
    "pullRequests",
    "issues",
    "relationships",
    "unknowns",
    "investigationNextSteps",
    "evidence",
  ],
  properties: {
    repository: {
      type: "object",
      required: ["id", "fullName", "owner", "name", "defaultBranch"],
      properties: {
        id: { type: "string" },
        fullName: { type: "string" },
        owner: { type: "string" },
        name: { type: "string" },
        defaultBranch: { type: "string" },
      },
    },
    generatedAt: { type: "string" },
    window: {
      type: "object",
      required: ["label", "days", "since"],
      properties: {
        label: { type: "string" },
        days: { type: "number" },
        since: { type: "string" },
      },
    },
    summary: { type: "array", items: { type: "string" } },
    counts: {
      type: "object",
      required: [
        "commits",
        "contributors",
        "filesChanged",
        "prsOpened",
        "prsMerged",
        "issuesOpened",
        "issuesClosed",
        "ciFailures",
        "ciRecoveries",
      ],
      properties: {
        commits: { type: "number" },
        contributors: { type: "number" },
        filesChanged: { type: "number" },
        prsOpened: { type: "number" },
        prsMerged: { type: "number" },
        issuesOpened: { type: "number" },
        issuesClosed: { type: "number" },
        ciFailures: { type: "number" },
        ciRecoveries: { type: "number" },
      },
    },
    whatChanged: { type: "array", items: sectionItemSchema },
    failures: { type: "array", items: sectionItemSchema },
    incidents: { type: "array", items: sectionItemSchema },
    risks: { type: "array", items: sectionItemSchema },
    pullRequests: { type: "array", items: sectionItemSchema },
    issues: { type: "array", items: sectionItemSchema },
    relationships: {
      type: "array",
      items: {
        type: "object",
        required: ["description", "path", "evidenceIds"],
        properties: {
          description: { type: "string" },
          path: {
            type: "array",
            items: {
              type: "object",
              required: ["entityType", "entityId", "label"],
              properties: {
                entityType: { type: "string" },
                entityId: { type: "string" },
                label: { type: "string" },
              },
            },
          },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    unknowns: { type: "array", items: { type: "string" } },
    investigationNextSteps: { type: "array", items: sectionItemSchema },
    evidence: { type: "array", items: evidenceItemSchema },
  },
} as const;

const claimSchema = {
  type: "object",
  required: ["claim", "evidenceIds"],
  properties: {
    claim: { type: "string" },
    evidenceIds: { type: "array", items: { type: "string" } },
  },
} as const;

const analysisSchema = {
  type: "object",
  required: ["status", "fingerprint", "cached"],
  properties: {
    status: { type: "string" },
    fingerprint: { type: "string" },
    model: { type: ["string", "null"] },
    cached: { type: "boolean" },
    analysis: {
      type: ["object", "null"],
      required: ["summary", "assessment"],
      properties: {
        summary: { type: "string" },
        assessment: { type: "string" },
        keyDevelopments: { type: "array", items: claimSchema },
        importantRisks: { type: "array", items: claimSchema },
        incidentAssessment: { type: "array", items: claimSchema },
        confirmedFacts: { type: "array", items: claimSchema },
        evidence: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "kind", "label", "detail"],
            properties: {
              id: { type: "string" },
              kind: { type: "string" },
              label: { type: "string" },
              detail: { type: "string" },
            },
          },
        },
        unknowns: { type: "array", items: { type: "string" } },
        investigationNextSteps: { type: "array", items: { type: "string" } },
      },
    },
    error: {
      type: ["object", "null"],
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const;

/**
 * Engineering Brief (Phase 13). Repository-scoped with ownership checks.
 * The deterministic brief is computed on every read; AI enhancement is
 * explicit (POST …/analyze) and cached per repository + window + evidence.
 */
export async function briefRoutes(app: FastifyInstance): Promise<void> {
  const guarded = {
    preHandler: [requireAuth, requireRepositoryAccess],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  };

  app.get("/repositories/:id/brief", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: {
        type: "object",
        properties: {
          window: { type: "string" },
        },
      },
      response: { 200: briefSchema },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as Record<string, string | undefined>;
      const window = parseBriefWindow(query.window);
      if (!window) {
        return reply.badRequest("Invalid window. Use recent, 7, or 30.");
      }
      const brief = await getEngineeringBrief(id, window);
      if (!brief) {
        return reply.notFound("Repository not found");
      }
      return reply.send(brief);
    },
  });

  app.get("/repositories/:id/brief/analysis", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: {
        type: "object",
        properties: {
          window: { type: "string" },
        },
      },
      response: { 200: analysisSchema },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as Record<string, string | undefined>;
      const window = parseBriefWindow(query.window);
      if (!window) {
        return reply.badRequest("Invalid window. Use recent, 7, or 30.");
      }
      const brief = await getEngineeringBrief(id, window);
      if (!brief) {
        return reply.notFound("Repository not found");
      }
      return reply.send(await getLatestBriefAnalysis(id, window.label));
    },
  });

  app.post("/repositories/:id/brief/analyze", {
    ...guarded,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      params: idParams,
      querystring: {
        type: "object",
        properties: {
          window: { type: "string" },
        },
      },
      response: { 200: analysisSchema },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as Record<string, string | undefined>;
      const window = parseBriefWindow(query.window);
      if (!window) {
        return reply.badRequest("Invalid window. Use recent, 7, or 30.");
      }
      const brief = await getEngineeringBrief(id, window);
      if (!brief) {
        return reply.notFound("Repository not found");
      }
      // Explicit user action only: never triggered by page loads, and the
      // evidence fingerprint cache prevents repeat model calls.
      return reply.send(await requestBriefAnalysis(id, window.label));
    },
  });
}
