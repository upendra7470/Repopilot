import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createRepository,
  getRepositoryById,
  getUserRepositories,
  linkUserRepository,
} from "../services/repository.service.js";
import {
  requireAuth,
  requireRepositoryAccess,
} from "../middleware/auth.js";
import { GithubApiError } from "../services/github-provider.js";
import {
  AlreadyConnectedError,
  connectRepository,
} from "../services/github-repos.service.js";
import {
  getLatestSyncRun,
  getRepositorySyncCounts,
  startRepositorySync,
  SyncError,
} from "../services/repo-sync.service.js";
import { getRepositoryOverview } from "../services/overview.service.js";
import { sendGithubError } from "./github-errors.js";

const connectSchema = z.object({
  owner: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
});

/**
 * Repository records scoped to the authenticated user.
 *
 * Every read is authorized against the user_repositories relationship:
 * - listing returns only the current user's repositories,
 * - fetching by id requires a relationship (otherwise privacy-preserving
 *   404 — the existence of other users' repositories is not leaked),
 * - creation links the new record to the creator as owner. The
 *   authenticated session is the source of identity; no client-supplied
 *   user id is trusted.
 */
const createRepositorySchema = z.object({
  owner: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  fullName: z.string().min(1),
  description: z.string().max(1000).optional(),
  defaultBranch: z.string().max(255).optional(),
  isPrivate: z.boolean().optional(),
  githubId: z.string().optional(),
});

type CreateRepositoryInput = z.infer<typeof createRepositorySchema>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared error envelope for the sync endpoint's failure statuses. */
const errorEnvelope = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const;

export async function repositoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/repositories", {
    preHandler: [requireAuth],
    schema: {
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "owner", "name", "fullName", "createdAt"],
            properties: {
              id: { type: "string" },
              owner: { type: "string" },
              name: { type: "string" },
              fullName: { type: "string" },
              description: { type: ["string", "null"] },
              defaultBranch: { type: "string" },
              isPrivate: { type: "boolean" },
              githubId: { type: ["string", "null"] },
              htmlUrl: { type: ["string", "null"] },
              archived: { type: "boolean" },
              fork: { type: "boolean" },
              connectionStatus: { type: "string" },
              syncStatus: { type: "string" },
              lastSyncedAt: { type: ["string", "null"] },
              lastSuccessfulSyncAt: { type: ["string", "null"] },
              role: { type: "string" },
              createdAt: { type: "string" },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const repos = await getUserRepositories(request.user!.id);
      return reply.send(repos);
    },
  });

  app.get("/repositories/:id", {
    preHandler: [requireAuth, requireRepositoryAccess],
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
          required: ["id", "owner", "name", "fullName", "createdAt"],
          properties: {
            id: { type: "string" },
            owner: { type: "string" },
            name: { type: "string" },
            fullName: { type: "string" },
            description: { type: ["string", "null"] },
            defaultBranch: { type: "string" },
            isPrivate: { type: "boolean" },
            githubId: { type: ["string", "null"] },
            htmlUrl: { type: ["string", "null"] },
            archived: { type: "boolean" },
            fork: { type: "boolean" },
            connectionStatus: { type: "string" },
            syncStatus: { type: "string" },
            lastSyncedAt: { type: ["string", "null"] },
            lastSuccessfulSyncAt: { type: ["string", "null"] },
            createdAt: { type: "string" },
            sync: {
              type: "object",
              required: ["branches", "commits", "files", "contributors"],
              properties: {
                branches: { type: "number" },
                commits: { type: "number" },
                files: { type: "number" },
                contributors: { type: "number" },
                lastRun: {
                  type: ["object", "null"],
                  required: ["status", "startedAt"],
                  properties: {
                    status: { type: "string" },
                    stage: { type: ["string", "null"] },
                    errorCode: { type: ["string", "null"] },
                    errorMessage: { type: ["string", "null"] },
                    startedAt: { type: "string" },
                    finishedAt: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!UUID_PATTERN.test(id)) {
        return reply.badRequest("Invalid repository id");
      }
      // Access already verified by requireRepositoryAccess.
      const repo = await getRepositoryById(id);
      if (!repo) {
        return reply.notFound("Repository not found");
      }
      const [counts, lastRun] = await Promise.all([
        getRepositorySyncCounts(id),
        getLatestSyncRun(id),
      ]);
      return reply.send({
        ...repo,
        sync: {
          ...counts,
          lastRun: lastRun
            ? {
                status: lastRun.status,
                stage: lastRun.stage,
                errorCode: lastRun.errorCode,
                errorMessage: lastRun.errorMessage,
                startedAt: lastRun.startedAt,
                finishedAt: lastRun.finishedAt,
              }
            : null,
        },
      });
    },
  });

  app.get("/repositories/:id/overview", {
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
          required: ["repository", "counts", "attention", "recentEvents"],
          properties: {
            repository: {
              type: "object",
              required: ["id", "fullName"],
              properties: {
                id: { type: "string" },
                fullName: { type: "string" },
                owner: { type: "string" },
                name: { type: "string" },
                defaultBranch: { type: "string" },
                isPrivate: { type: "boolean" },
                syncStatus: { type: "string" },
                lastSyncedAt: { type: ["string", "null"] },
                lastSuccessfulSyncAt: { type: ["string", "null"] },
              },
            },
            counts: {
              type: "object",
              required: ["branches", "commits", "files", "contributors"],
              properties: {
                branches: { type: "number" },
                commits: { type: "number" },
                files: { type: "number" },
                contributors: { type: "number" },
                prs: {
                  type: "object",
                  required: ["open", "merged", "closed"],
                  properties: {
                    open: { type: "number" },
                    merged: { type: "number" },
                    closed: { type: "number" },
                  },
                },
                issues: {
                  type: "object",
                  required: ["open", "closed"],
                  properties: {
                    open: { type: "number" },
                    closed: { type: "number" },
                  },
                },
                workflows: { type: "number" },
                runs: { type: "number" },
              },
            },
            attention: {
              type: "array",
              items: {
                type: "object",
                required: ["kind", "severity", "title", "detail", "href"],
                properties: {
                  kind: { type: "string" },
                  severity: { type: "string" },
                  title: { type: "string" },
                  detail: { type: "string" },
                  href: { type: "string" },
                },
              },
            },
            recentEvents: {
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
            recentPrs: {
              type: "array",
              items: {
                type: "object",
                required: ["number"],
                properties: {
                  number: { type: "number" },
                  title: { type: ["string", "null"] },
                  state: { type: "string" },
                  merged: { type: "boolean" },
                  authorLogin: { type: ["string", "null"] },
                  githubUpdatedAt: { type: ["string", "null"] },
                },
              },
            },
            recentIssues: {
              type: "array",
              items: {
                type: "object",
                required: ["number"],
                properties: {
                  number: { type: "number" },
                  title: { type: ["string", "null"] },
                  state: { type: "string" },
                  authorLogin: { type: ["string", "null"] },
                  githubUpdatedAt: { type: ["string", "null"] },
                },
              },
            },
            topContributors: {
              type: "array",
              items: {
                type: "object",
                required: ["login", "commitCount"],
                properties: {
                  login: { type: "string" },
                  name: { type: ["string", "null"] },
                  commitCount: { type: "number" },
                  lastCommitAt: { type: ["string", "null"] },
                },
              },
            },
            hotFiles: {
              type: "array",
              items: {
                type: "object",
                required: ["path", "changes"],
                properties: {
                  path: { type: "string" },
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
      if (!UUID_PATTERN.test(id)) {
        return reply.badRequest("Invalid repository id");
      }
      // Access already verified by requireRepositoryAccess.
      const overview = await getRepositoryOverview(id);
      if (!overview) {
        return reply.notFound("Repository not found");
      }
      return reply.send(overview);
    },
  });

  app.post("/repositories/:id/sync", {
    preHandler: [requireAuth, requireRepositoryAccess],
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
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
          required: ["runId", "status"],
          properties: {
            runId: { type: "string" },
            status: { type: "string" },
            branchCount: { type: "number" },
            commitCount: { type: "number" },
            fileCount: { type: "number" },
            contributorCount: { type: "number" },
            prCount: { type: "number" },
            issueCount: { type: "number" },
            workflowCount: { type: "number" },
            workflowRunCount: { type: "number" },
            truncatedTree: { type: "boolean" },
            durationMs: { type: "number" },
          },
        },
        400: errorEnvelope,
        403: errorEnvelope,
        404: errorEnvelope,
        409: errorEnvelope,
        502: errorEnvelope,
        503: errorEnvelope,
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const summary = await startRepositorySync(request.user!.id, id);
        return reply.send(summary);
      } catch (err) {
        if (err instanceof SyncError) {
          return reply.status(err.httpStatus).send({
            error: { code: err.code, message: err.message },
          });
        }
        if (err instanceof GithubApiError) {
          return sendGithubError(err, reply);
        }
        throw err;
      }
    },
  });

  app.post("/repositories", {
    preHandler: [requireAuth],
    schema: {
      body: {
        type: "object",
        required: ["owner", "name", "fullName"],
        properties: {
          owner: { type: "string" },
          name: { type: "string" },
          fullName: { type: "string" },
          description: { type: "string" },
          defaultBranch: { type: "string" },
          isPrivate: { type: "boolean" },
          githubId: { type: "string" },
        },
      },
      response: {
        201: {
          type: "object",
          required: ["id", "owner", "name", "fullName", "createdAt"],
          properties: {
            id: { type: "string" },
            owner: { type: "string" },
            name: { type: "string" },
            fullName: { type: "string" },
            description: { type: ["string", "null"] },
            defaultBranch: { type: "string" },
            isPrivate: { type: "boolean" },
            githubId: { type: ["string", "null"] },
            htmlUrl: { type: ["string", "null"] },
            archived: { type: "boolean" },
            fork: { type: "boolean" },
            connectionStatus: { type: "string" },
            syncStatus: { type: "string" },
            lastSyncedAt: { type: ["string", "null"] },
            lastSuccessfulSyncAt: { type: ["string", "null"] },
            createdAt: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const parsed = createRepositorySchema.safeParse(body);

      if (!parsed.success) {
        return reply.badRequest(
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }

      const input: CreateRepositoryInput = parsed.data;
      const repo = await createRepository({
        owner: input.owner,
        name: input.name,
        fullName: input.fullName,
        description: input.description,
        defaultBranch: input.defaultBranch,
        isPrivate: input.isPrivate,
        githubId: input.githubId,
      });
      await linkUserRepository(request.user!.id, repo.id, "owner");

      return reply.status(201).send(repo);
    },
  });

  app.get("/users/:userId/repositories", {
    preHandler: [requireAuth],
    schema: {
      params: {
        type: "object",
        required: ["userId"],
        properties: {
          userId: { type: "string" },
        },
      },
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "owner", "name", "fullName", "createdAt"],
            properties: {
              id: { type: "string" },
              owner: { type: "string" },
              name: { type: "string" },
              fullName: { type: "string" },
              description: { type: ["string", "null"] },
              defaultBranch: { type: "string" },
              isPrivate: { type: "boolean" },
              githubId: { type: ["string", "null"] },
              htmlUrl: { type: ["string", "null"] },
              archived: { type: "boolean" },
              fork: { type: "boolean" },
              connectionStatus: { type: "string" },
              role: { type: "string" },
              createdAt: { type: "string" },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      // Users may only list their own repositories; anything else is 404
      // so user ids cannot be used to probe other users' data.
      if (userId !== request.user!.id) {
        return reply.notFound("Repositories not found");
      }
      const repos = await getUserRepositories(userId);
      return reply.send(repos);
    },
  });

  app.post("/repositories/connect", {
    preHandler: [requireAuth],
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: {
      body: {
        type: "object",
        required: ["owner", "name"],
        properties: {
          owner: { type: "string" },
          name: { type: "string" },
        },
      },
      response: {
        201: {
          type: "object",
          required: ["id", "owner", "name", "fullName", "createdAt"],
          properties: {
            id: { type: "string" },
            owner: { type: "string" },
            name: { type: "string" },
            fullName: { type: "string" },
            description: { type: ["string", "null"] },
            defaultBranch: { type: "string" },
            isPrivate: { type: "boolean" },
            githubId: { type: ["string", "null"] },
            htmlUrl: { type: ["string", "null"] },
            archived: { type: "boolean" },
            fork: { type: "boolean" },
            connectionStatus: { type: "string" },
            createdAt: { type: "string" },
          },
        },
        409: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
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
      const body = connectSchema.safeParse(request.body);
      if (!body.success) {
        return reply.badRequest(
          body.error.issues.map((i) => i.message).join(", "),
        );
      }

      try {
        const record = await connectRepository(
          request.user!.id,
          body.data.owner,
          body.data.name,
        );
        return reply.status(201).send(record);
      } catch (err) {
        if (err instanceof AlreadyConnectedError) {
          return reply.status(409).send({
            error: {
              code: "ALREADY_CONNECTED",
              message: "Repository is already connected.",
            },
          });
        }
        if (err instanceof GithubApiError) {
          return sendGithubError(err, reply);
        }
        throw err;
      }
    },
  });
}
