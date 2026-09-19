import type { FastifyInstance } from "fastify";
import {
  requireAuth,
  requireRepositoryAccess,
} from "../middleware/auth.js";
import {
  detectIncidents,
  getIncident,
} from "../services/incident-intelligence.service.js";
import {
  getLatestIncidentAnalysis,
  requestIncidentAnalysis,
} from "../services/incident-analysis.service.js";

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

const incidentParams = {
  type: "object",
  required: ["id", "incidentId"],
  properties: {
    id: { type: "string" },
    incidentId: { type: "string" },
  },
} as const;

const evidenceRefSchema = {
  type: "object",
  required: ["kind", "value", "label"],
  properties: {
    kind: { type: "string" },
    value: { type: "string" },
    label: { type: "string" },
  },
} as const;

const incidentSchema = {
  type: "object",
  required: ["fingerprint", "title", "status", "severity"],
  properties: {
    fingerprint: { type: "string" },
    repositoryId: { type: "string" },
    title: { type: "string" },
    status: { type: "string" },
    severity: { type: "string" },
    confidence: { type: "string" },
    confidenceReason: { type: "string" },
    workflowGithubId: { type: "string" },
    workflowName: { type: ["string", "null"] },
    branch: { type: "string" },
    burstLength: { type: "number" },
    burstStartAt: { type: ["string", "null"] },
    burstEndAt: { type: ["string", "null"] },
    recoveryRunGithubId: { type: ["string", "null"] },
    recoveryAt: { type: ["string", "null"] },
    summary: { type: "string" },
    timeline: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "title", "ref"],
        properties: {
          at: { type: ["string", "null"] },
          kind: { type: "string" },
          title: { type: "string" },
          detail: { type: ["string", "null"] },
          ref: evidenceRefSchema,
        },
      },
    },
    evidence: { type: "array", items: evidenceRefSchema },
    linkedPrNumbers: { type: "array", items: { type: "number" } },
    linkedIssueNumbers: { type: "array", items: { type: "number" } },
    filePaths: { type: "array", items: { type: "string" } },
    riskFindingIds: { type: "array", items: { type: "string" } },
    contributorLogins: { type: "array", items: { type: "string" } },
    unknowns: { type: "array", items: { type: "string" } },
  },
} as const;

function parseFingerprint(raw: string): string | null {
  return /^[0-9a-f]{64}$/.test(raw) ? raw : null;
}

/**
 * Incident intelligence (Phase 11). Repository-scoped with ownership
 * checks; incidents are dynamic reconstructions addressed by their stable
 * fingerprint, so an unknown fingerprint is a privacy-preserving 404.
 */
export async function incidentRoutes(app: FastifyInstance): Promise<void> {
  const guarded = {
    preHandler: [requireAuth, requireRepositoryAccess],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  };

  app.get("/repositories/:id/incidents", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: {
        type: "object",
        properties: {
          status: { type: "string" },
          severity: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          required: ["data"],
          properties: {
            data: { type: "array", items: incidentSchema },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as Record<string, string | undefined>;
      if (
        query.status !== undefined &&
        !["active", "recovered", "all"].includes(query.status)
      ) {
        return reply.badRequest("Invalid status filter");
      }
      if (
        query.severity !== undefined &&
        !["medium", "high", "all"].includes(query.severity)
      ) {
        return reply.badRequest("Invalid severity filter");
      }
      const incidents = await detectIncidents(id);
      return reply.send({
        data: incidents.filter(
          (incident) =>
            (query.status === undefined ||
              query.status === "all" ||
              incident.status === query.status) &&
            (query.severity === undefined ||
              query.severity === "all" ||
              incident.severity === query.severity),
        ),
      });
    },
  });

  app.get("/repositories/:id/incidents/:incidentId", {
    ...guarded,
    schema: {
      params: incidentParams,
      response: { 200: incidentSchema },
    },
    handler: async (request, reply) => {
      const { id, incidentId } = request.params as { id: string; incidentId: string };
      if (parseFingerprint(incidentId) === null) {
        return reply.badRequest("Invalid incident id");
      }
      const incident = await getIncident(id, incidentId);
      if (!incident) {
        return reply.notFound("Incident not found");
      }
      return reply.send(incident);
    },
  });

  app.get("/repositories/:id/incidents/:incidentId/analysis", {
    ...guarded,
    schema: {
      params: incidentParams,
      response: {
        200: {
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
                likelyContributingFactors: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["claim", "evidenceIds"],
                    properties: {
                      claim: { type: "string" },
                      evidenceIds: { type: "array", items: { type: "string" } },
                    },
                  },
                },
                confirmedFacts: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["claim", "evidenceIds"],
                    properties: {
                      claim: { type: "string" },
                      evidenceIds: { type: "array", items: { type: "string" } },
                    },
                  },
                },
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
        },
      },
    },
    handler: async (request, reply) => {
      const { id, incidentId } = request.params as { id: string; incidentId: string };
      if (parseFingerprint(incidentId) === null) {
        return reply.badRequest("Invalid incident id");
      }
      const incident = await getIncident(id, incidentId);
      if (!incident) {
        return reply.notFound("Incident not found");
      }
      return reply.send(await getLatestIncidentAnalysis(id, incidentId));
    },
  });

  app.post("/repositories/:id/incidents/:incidentId/analyze", {
    ...guarded,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      params: incidentParams,
      response: {
        200: {
          type: "object",
          required: ["status", "fingerprint", "cached"],
          properties: {
            status: { type: "string" },
            fingerprint: { type: "string" },
            model: { type: ["string", "null"] },
            cached: { type: "boolean" },
            analysis: { type: ["object", "null"] },
            error: {
              type: ["object", "null"],
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id, incidentId } = request.params as { id: string; incidentId: string };
      if (parseFingerprint(incidentId) === null) {
        return reply.badRequest("Invalid incident id");
      }
      const incident = await getIncident(id, incidentId);
      if (!incident) {
        return reply.notFound("Incident not found");
      }
      // Explicit user action only: never triggered by page loads, and the
      // evidence fingerprint cache prevents repeat model calls.
      return reply.send(await requestIncidentAnalysis(id, incidentId));
    },
  });
}
