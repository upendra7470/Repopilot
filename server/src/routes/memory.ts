import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  requireAuth,
  requireRepositoryAccess,
} from "../middleware/auth.js";
import {
  getContributorActivity,
  getContributorSummaries,
  getEngineeringTimeline,
  getFileHistory,
  getFrequentlyChangedFiles,
  getMemoryOverview,
  getRecentActivity,
  listRepositoryFiles,
  searchMemory,
} from "../services/memory.service.js";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

const activityEventSchema = {
  type: "object",
  required: ["kind", "title"],
  properties: {
    kind: { type: "string" },
    sha: { type: ["string", "null"] },
    title: { type: "string" },
    authorLogin: { type: ["string", "null"] },
    at: { type: ["string", "null"] },
  },
} as const;

/**
 * Engineering Memory reads (Phase 6). Every route requires authentication
 * plus an authorized user→repository relationship; all data comes from
 * synced PostgreSQL records — never demo fixtures, never inference.
 */
export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  const guarded = {
    preHandler: [requireAuth, requireRepositoryAccess],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  };

  app.get("/repositories/:id/memory", {
    ...guarded,
    schema: {
      params: idParams,
      response: {
        200: {
          type: "object",
          required: ["counts", "recentActivity"],
          properties: {
            counts: {
              type: "object",
              required: ["branches", "commits", "files", "contributors"],
              properties: {
                branches: { type: "number" },
                commits: { type: "number" },
                files: { type: "number" },
                contributors: { type: "number" },
              },
            },
            recentActivity: { type: "array", items: activityEventSchema },
            frequentlyChangedFiles: {
              type: "array",
              items: {
                type: "object",
                required: ["path", "changes"],
                properties: {
                  path: { type: "string" },
                  changes: { type: "number" },
                  contributors: { type: "number" },
                  additions: { type: "number" },
                  deletions: { type: "number" },
                },
              },
            },
            activeContributors: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "login", "commitCount"],
                properties: {
                  id: { type: "string" },
                  login: { type: "string" },
                  name: { type: ["string", "null"] },
                  avatarUrl: { type: ["string", "null"] },
                  commitCount: { type: "number" },
                  lastCommitAt: { type: ["string", "null"] },
                },
              },
            },
            areas: {
              type: "array",
              items: {
                type: "object",
                required: ["area", "files", "changes"],
                properties: {
                  area: { type: "string" },
                  files: { type: "number" },
                  changes: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await getMemoryOverview(id));
    },
  });

  app.get("/repositories/:id/timeline", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
      response: {
        200: {
          type: "array",
          items: activityEventSchema,
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit } = request.query as { limit?: number };
      return reply.send(await getRecentActivity(id, limit ?? 20));
    },
  });

  app.get("/repositories/:id/files", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: {
        type: "object",
        properties: {
          prefix: { type: "string" },
          limit: { type: "number" },
        },
      },
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "path"],
            properties: {
              id: { type: "string" },
              path: { type: "string" },
              type: { type: ["string", "null"] },
              size: { type: ["number", "null"] },
              sha: { type: ["string", "null"] },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { prefix, limit } = request.query as {
        prefix?: string;
        limit?: number;
      };
      return reply.send(await listRepositoryFiles(id, { prefix, limit }));
    },
  });

  app.get("/repositories/:id/files/:fileId/history", {
    ...guarded,
    schema: {
      params: {
        type: "object",
        required: ["id", "fileId"],
        properties: {
          id: { type: "string" },
          fileId: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          required: ["file", "changeCount", "history"],
          properties: {
            file: {
              type: "object",
              required: ["id", "path"],
              properties: {
                id: { type: "string" },
                path: { type: "string" },
                type: { type: ["string", "null"] },
                size: { type: ["number", "null"] },
                sha: { type: ["string", "null"] },
              },
            },
            changeCount: { type: "number" },
            contributors: {
              type: "array",
              items: {
                type: "object",
                required: ["login", "changes"],
                properties: {
                  login: { type: "string" },
                  changes: { type: "number" },
                },
              },
            },
            latestChange: {
              type: ["object", "null"],
              required: ["sha"],
              properties: {
                sha: { type: ["string", "null"] },
                message: { type: ["string", "null"] },
                authorLogin: { type: ["string", "null"] },
                committedAt: { type: ["string", "null"] },
                status: { type: ["string", "null"] },
                additions: { type: ["number", "null"] },
                deletions: { type: ["number", "null"] },
              },
            },
            history: {
              type: "array",
              items: {
                type: "object",
                required: ["sha"],
                properties: {
                  sha: { type: ["string", "null"] },
                  message: { type: ["string", "null"] },
                  authorLogin: { type: ["string", "null"] },
                  committedAt: { type: ["string", "null"] },
                  status: { type: ["string", "null"] },
                  additions: { type: ["number", "null"] },
                  deletions: { type: ["number", "null"] },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id, fileId } = request.params as { id: string; fileId: string };
      if (!UUID_PATTERN.test(fileId)) {
        return reply.badRequest("Invalid file id");
      }
      const history = await getFileHistory(id, fileId);
      if (!history) {
        return reply.notFound("File not found");
      }
      return reply.send(history);
    },
  });

  app.get("/repositories/:id/contributors", {
    ...guarded,
    schema: {
      params: idParams,
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "login", "commitCount"],
            properties: {
              id: { type: "string" },
              login: { type: "string" },
              name: { type: ["string", "null"] },
              avatarUrl: { type: ["string", "null"] },
              commitCount: { type: "number" },
              lastCommitAt: { type: ["string", "null"] },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await getContributorSummaries(id));
    },
  });

  app.get("/repositories/:id/contributors/:contributorId", {
    ...guarded,
    schema: {
      params: {
        type: "object",
        required: ["id", "contributorId"],
        properties: {
          id: { type: "string" },
          contributorId: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          required: ["contributor", "commitCount", "filesTouched"],
          properties: {
            contributor: {
              type: "object",
              required: ["id", "login"],
              properties: {
                id: { type: "string" },
                login: { type: "string" },
                name: { type: ["string", "null"] },
                email: { type: ["string", "null"] },
                avatarUrl: { type: ["string", "null"] },
              },
            },
            commitCount: { type: "number" },
            filesTouched: { type: "number" },
            firstCommitAt: { type: ["string", "null"] },
            lastCommitAt: { type: ["string", "null"] },
            frequentAreas: {
              type: "array",
              items: {
                type: "object",
                required: ["area", "changes"],
                properties: {
                  area: { type: "string" },
                  changes: { type: "number" },
                },
              },
            },
            recentCommits: {
              type: "array",
              items: {
                type: "object",
                required: ["sha"],
                properties: {
                  sha: { type: "string" },
                  message: { type: ["string", "null"] },
                  committedAt: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id, contributorId } = request.params as {
        id: string;
        contributorId: string;
      };
      if (!UUID_PATTERN.test(contributorId)) {
        return reply.badRequest("Invalid contributor id");
      }
      const activity = await getContributorActivity(id, contributorId);
      if (!activity) {
        return reply.notFound("Contributor not found");
      }
      return reply.send(activity);
    },
  });

  app.get("/repositories/:id/activity", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: {
        type: "object",
        properties: {
          q: { type: "string" },
          limit: { type: "number" },
        },
      },
      response: {
        200: {
          type: "object",
          required: ["files", "commits", "contributors"],
          properties: {
            files: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "path"],
                properties: {
                  id: { type: "string" },
                  path: { type: "string" },
                  type: { type: ["string", "null"] },
                },
              },
            },
            commits: {
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
            contributors: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "login"],
                properties: {
                  id: { type: "string" },
                  login: { type: "string" },
                  name: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({ q: z.string().min(1).max(200), limit: z.coerce.number().int().min(1).max(50).optional() })
        .safeParse(request.query);
      if (!parsed.success) {
        return reply.badRequest("Query parameter `q` is required");
      }
      return reply.send(
        await searchMemory(id, parsed.data.q, parsed.data.limit ?? 20),
      );
    },
  });

  app.get("/repositories/:id/changed-files", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["path", "changes"],
            properties: {
              path: { type: "string" },
              changes: { type: "number" },
              contributors: { type: "number" },
              additions: { type: "number" },
              deletions: { type: "number" },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit } = request.query as { limit?: number };
      return reply.send(await getFrequentlyChangedFiles(id, limit ?? 20));
    },
  });

  app.get("/repositories/:id/events", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["kind", "title", "ref"],
            properties: {
              kind: { type: "string" },
              at: { type: ["string", "null"] },
              title: { type: "string" },
              subtitle: { type: ["string", "null"] },
              authorLogin: { type: ["string", "null"] },
              state: { type: ["string", "null"] },
              ref: {
                type: "object",
                required: ["entity", "value"],
                properties: {
                  entity: { type: "string" },
                  value: { type: "string" },
                },
              },
              workflowName: { type: ["string", "null"] },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit } = request.query as { limit?: number };
      return reply.send(await getEngineeringTimeline(id, limit ?? 30));
    },
  });
}
