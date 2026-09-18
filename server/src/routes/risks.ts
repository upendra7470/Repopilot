import type { FastifyInstance } from "fastify";
import {
  requireAuth,
  requireRepositoryAccess,
} from "../middleware/auth.js";
import { analyzeRepositoryRisks } from "../services/risk.service.js";

const evidenceSchema = {
  type: "object",
  required: ["label", "value"],
  properties: {
    label: { type: "string" },
    value: { type: "string" },
    ref: {
      type: ["object", "null"],
      required: ["kind", "value"],
      properties: {
        kind: { type: "string" },
        value: { type: "string" },
      },
    },
  },
} as const;

/**
 * Deterministic risk findings computed from synced PostgreSQL records.
 * Repository-scoped, authenticated, privacy-preserving 404s — no global
 * risks, no demo data, no inference.
 */
export async function riskRoutes(app: FastifyInstance): Promise<void> {
  app.get("/repositories/:id/risks", {
    preHandler: [requireAuth, requireRepositoryAccess],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          required: ["repository", "generatedAt", "analysisWindow", "summary", "findings"],
          properties: {
            repository: {
              type: "object",
              required: ["id", "fullName"],
              properties: {
                id: { type: "string" },
                fullName: { type: "string" },
              },
            },
            generatedAt: { type: "string" },
            analysisWindow: {
              type: "object",
              required: ["type", "value", "start", "end"],
              properties: {
                type: { type: "string" },
                value: { type: "number" },
                start: { type: "string" },
                end: { type: "string" },
              },
            },
            summary: {
              type: "object",
              required: ["total", "critical", "high", "medium", "low"],
              properties: {
                total: { type: "number" },
                critical: { type: "number" },
                high: { type: "number" },
                medium: { type: "number" },
                low: { type: "number" },
              },
            },
            findings: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "id",
                  "type",
                  "severity",
                  "title",
                  "summary",
                  "detectedAt",
                  "evidence",
                  "affectedFiles",
                  "affectedContributors",
                  "relatedCommits",
                  "recommendation",
                ],
                properties: {
                  id: { type: "string" },
                  type: { type: "string" },
                  severity: { type: "string" },
                  title: { type: "string" },
                  summary: { type: "string" },
                  detectedAt: { type: "string" },
                  evidence: { type: "array", items: evidenceSchema },
                  affectedFiles: { type: "array", items: { type: "string" } },
                  affectedContributors: {
                    type: "array",
                    items: { type: "string" },
                  },
                  relatedCommits: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["sha"],
                      properties: {
                        sha: { type: "string" },
                        message: { type: ["string", "null"] },
                        authorLogin: { type: ["string", "null"] },
                        committedAt: { type: ["string", "null"] },
                      },
                    },
                  },
                  recommendation: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await analyzeRepositoryRisks(id));
    },
  });
}
