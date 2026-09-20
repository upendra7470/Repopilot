import type { FastifyInstance } from "fastify";
import {
  requireAuth,
  requireRepositoryAccess,
} from "../middleware/auth.js";
import { buildGraph } from "../services/graph.service.js";

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

const graphQuerySchema = {
  type: "object",
  properties: {
    entityType: { type: "string" },
    entityId: { type: "string" },
    depth: { type: "integer", minimum: 1, maximum: 3, default: 2 },
    limit: { type: "integer", minimum: 1, maximum: 500, default: 200 },
  },
} as const;

const graphNodeSchema = {
  type: "object",
  required: ["id", "type", "label", "metadata"],
  properties: {
    id: { type: "string" },
    type: { type: "string" },
    label: { type: "string" },
    metadata: { type: "object" },
  },
} as const;

const graphEdgeSchema = {
  type: "object",
  required: ["id", "sourceId", "targetId", "type", "evidenceIds", "provenance"],
  properties: {
    id: { type: "string" },
    sourceId: { type: "string" },
    targetId: { type: "string" },
    type: { type: "string" },
    evidenceIds: { type: "array", items: { type: "string" } },
    provenance: {
      type: "object",
      required: ["source", "reason"],
      properties: {
        source: { type: "string" },
        reason: { type: "string" },
      },
    },
  },
} as const;

const graphMetaSchema = {
  type: "object",
  required: ["depth", "nodeCount", "edgeCount", "truncated"],
  properties: {
    depth: { type: "integer" },
    nodeCount: { type: "integer" },
    edgeCount: { type: "integer" },
    truncated: { type: "boolean" },
  },
} as const;

const graphResponseSchema = {
  type: "object",
  required: ["repositoryId", "nodes", "edges", "meta"],
  properties: {
    repositoryId: { type: "string" },
    root: {
      type: ["object", "null"],
      properties: {
        id: { type: "string" },
        type: { type: "string" },
      },
    },
    nodes: { type: "array", items: graphNodeSchema },
    edges: { type: "array", items: graphEdgeSchema },
    meta: graphMetaSchema,
  },
} as const;

export async function graphRoutes(app: FastifyInstance): Promise<void> {
  const guarded = {
    preHandler: [requireAuth, requireRepositoryAccess],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  };

  app.get("/repositories/:id/graph", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: graphQuerySchema,
      response: { 200: graphResponseSchema },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as {
        entityType?: string;
        entityId?: string;
        depth?: number;
        limit?: number;
      };

      // Validate entityType if provided
      const validEntityTypes = [
        "commit",
        "file",
        "contributor",
        "pull_request",
        "issue",
        "ci_workflow",
        "ci_run",
        "risk",
        "incident",
      ];
      if (query.entityType && !validEntityTypes.includes(query.entityType)) {
        return reply.badRequest("Invalid entityType");
      }

      // Validate entityId if entityType is provided
      if (query.entityType && !query.entityId) {
        return reply.badRequest("entityId is required when entityType is provided");
      }

      // Validate depth
      const depth = Math.min(Math.max(1, query.depth ?? 2), 3);
      const limit = Math.min(Math.max(1, query.limit ?? 200), 500);

      try {
        const graph = await buildGraph(id, {
          entityType: query.entityType,
          entityId: query.entityId,
          depth,
          limit,
        });
        return reply.send(graph);
      } catch (err) {
        const logger = (await import("../utils/logger.js")).getLogger();
        logger.error({ err, repositoryId: id }, "Graph build failed");
        if (err instanceof Error && err.message === "Repository not found") {
          return reply.notFound("Repository not found");
        }
        return reply.internalServerError("Failed to build graph");
      }
    },
  });
}