import type { FastifyInstance } from "fastify";
import {
  requireAuth,
  requireRepositoryAccess,
} from "../middleware/auth.js";
import {
  getCiSummary,
  getRunDetail,
  getWorkflow,
  listRuns,
  listWorkflows,
} from "../services/ci-intelligence.service.js";
import {
  getLatestCiAnalysis,
  requestCiAnalysis,
} from "../services/ci-analysis.service.js";

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

const workflowParams = {
  type: "object",
  required: ["id", "workflowId"],
  properties: {
    id: { type: "string" },
    workflowId: { type: "string" },
  },
} as const;

const runParams = {
  type: "object",
  required: ["id", "runId"],
  properties: {
    id: { type: "string" },
    runId: { type: "string" },
  },
} as const;

const signalSchema = {
  type: "object",
  required: ["type", "severity", "title", "detail", "evidence"],
  properties: {
    type: { type: "string" },
    severity: { type: "string" },
    title: { type: "string" },
    detail: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "value"],
        properties: {
          label: { type: "string" },
          value: { type: "string" },
        },
      },
    },
  },
} as const;

const workflowSchema = {
  type: "object",
  required: ["id", "githubId"],
  properties: {
    id: { type: "string" },
    githubId: { type: "string" },
    name: { type: ["string", "null"] },
    path: { type: ["string", "null"] },
    state: { type: ["string", "null"] },
    badgeUrl: { type: ["string", "null"] },
    htmlUrl: { type: ["string", "null"] },
    githubCreatedAt: { type: ["string", "null"] },
    githubUpdatedAt: { type: ["string", "null"] },
  },
} as const;

const runSchema = {
  type: "object",
  required: ["id", "githubId"],
  properties: {
    id: { type: "string" },
    githubId: { type: "string" },
    runNumber: { type: ["number", "null"] },
    name: { type: ["string", "null"] },
    event: { type: ["string", "null"] },
    status: { type: ["string", "null"] },
    conclusion: { type: ["string", "null"] },
    headBranch: { type: ["string", "null"] },
    headSha: { type: ["string", "null"] },
    runAttempt: { type: ["number", "null"] },
    actorLogin: { type: ["string", "null"] },
    prNumbers: { type: "array", items: { type: "number" } },
    htmlUrl: { type: ["string", "null"] },
    durationSec: { type: ["number", "null"] },
    githubCreatedAt: { type: ["string", "null"] },
    githubUpdatedAt: { type: ["string", "null"] },
    startedAt: { type: ["string", "null"] },
    completedAt: { type: ["string", "null"] },
  },
} as const;

const runWithContextSchema = {
  type: "object",
  required: ["id", "githubId"],
  properties: {
    ...(runSchema.properties as Record<string, unknown>),
    workflowName: { type: ["string", "null"] },
    linkedPrs: { type: "array", items: { type: "number" } },
  },
} as const;

/** GitHub numeric IDs: digits only, kept as strings (no precision loss). */
function parseGithubId(raw: string): string | null {
  return /^\d{1,20}$/.test(raw) ? raw : null;
}

/**
 * CI intelligence (Phase 10). Repository-scoped with ownership checks;
 * workflows and runs are addressed by their GitHub IDs within the
 * repository so records from other repositories cannot leak across.
 */
export async function ciRoutes(app: FastifyInstance): Promise<void> {
  const guarded = {
    preHandler: [requireAuth, requireRepositoryAccess],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  };

  app.get("/repositories/:id/ci", {
    ...guarded,
    schema: {
      params: idParams,
      response: {
        200: {
          type: "object",
          required: ["counts", "signals", "workflows", "recentRuns"],
          properties: {
            counts: {
              type: "object",
              required: [
                "workflows",
                "activeWorkflows",
                "runs",
                "running",
                "completed",
                "success",
                "failed",
                "other",
              ],
              properties: {
                workflows: { type: "number" },
                activeWorkflows: { type: "number" },
                runs: { type: "number" },
                running: { type: "number" },
                completed: { type: "number" },
                success: { type: "number" },
                failed: { type: "number" },
                other: { type: "number" },
                successRate: { type: ["number", "null"] },
              },
            },
            signals: { type: "array", items: signalSchema },
            failureStreaks: {
              type: "array",
              items: {
                type: "object",
                required: ["workflowGithubId", "streak", "lastRunGithubId"],
                properties: {
                  workflowGithubId: { type: "string" },
                  workflowName: { type: ["string", "null"] },
                  streak: { type: "number" },
                  lastRunGithubId: { type: "string" },
                },
              },
            },
            unstableWorkflows: {
              type: "array",
              items: {
                type: "object",
                required: ["workflowGithubId", "failures", "window"],
                properties: {
                  workflowGithubId: { type: "string" },
                  workflowName: { type: ["string", "null"] },
                  failures: { type: "number" },
                  window: { type: "number" },
                },
              },
            },
            recentFailures: { type: "array", items: runWithContextSchema },
            staleRuns: { type: "array", items: runWithContextSchema },
            recovered: {
              type: "array",
              items: {
                type: "object",
                required: ["workflowGithubId", "afterStreak"],
                properties: {
                  workflowGithubId: { type: "string" },
                  workflowName: { type: ["string", "null"] },
                  afterStreak: { type: "number" },
                },
              },
            },
            prCiStates: {
              type: "array",
              items: {
                type: "object",
                required: ["prNumber", "state"],
                properties: {
                  prNumber: { type: "number" },
                  prTitle: { type: ["string", "null"] },
                  state: { type: "string" },
                  runGithubId: { type: ["string", "null"] },
                  workflowName: { type: ["string", "null"] },
                  conclusion: { type: ["string", "null"] },
                },
              },
            },
            lastFailureAt: { type: ["string", "null"] },
            workflows: {
              type: "array",
              items: {
                type: "object",
                required: ["workflow", "active", "failureStreak", "unstable"],
                properties: {
                  workflow: workflowSchema,
                  active: { type: "boolean" },
                  lastRun: { type: ["object", "null"] },
                  recentFailures: { type: "number" },
                  failureStreak: { type: "number" },
                  unstable: { type: "boolean" },
                },
              },
            },
            recentRuns: { type: "array", items: runWithContextSchema },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const [summary, workflows, runsPage] = await Promise.all([
        getCiSummary(id),
        listWorkflows(id),
        listRuns(id, { page: 1, perPage: 20 }),
      ]);
      return reply.send({ ...summary, workflows, recentRuns: runsPage.data });
    },
  });

  app.get("/repositories/:id/ci/workflows", {
    ...guarded,
    schema: {
      params: idParams,
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["workflow", "active", "failureStreak", "unstable"],
            properties: {
              workflow: workflowSchema,
              active: { type: "boolean" },
              lastRun: runSchema,
              recentFailures: { type: "number" },
              failureStreak: { type: "number" },
              unstable: { type: "boolean" },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await listWorkflows(id));
    },
  });

  app.get("/repositories/:id/ci/workflows/:workflowId", {
    ...guarded,
    schema: {
      params: workflowParams,
      response: {
        200: {
          type: "object",
          required: ["workflow", "active", "failureStreak", "unstable"],
          properties: {
            workflow: workflowSchema,
            active: { type: "boolean" },
            lastRun: runSchema,
            recentFailures: { type: "number" },
            failureStreak: { type: "number" },
            unstable: { type: "boolean" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id, workflowId } = request.params as { id: string; workflowId: string };
      if (parseGithubId(workflowId) === null) {
        return reply.badRequest("Invalid workflow id");
      }
      const workflow = await getWorkflow(id, workflowId);
      if (!workflow) {
        return reply.notFound("Workflow not found");
      }
      return reply.send(workflow);
    },
  });

  app.get("/repositories/:id/ci/runs", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: {
        type: "object",
        properties: {
          workflow: { type: "string" },
          branch: { type: "string" },
          status: { type: "string" },
          conclusion: { type: "string" },
          pr: { type: "string" },
          page: { type: "string" },
          per_page: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          required: ["data", "pagination"],
          properties: {
            data: { type: "array", items: runWithContextSchema },
            pagination: {
              type: "object",
              required: ["page", "perPage", "total"],
              properties: {
                page: { type: "number" },
                perPage: { type: "number" },
                total: { type: "number" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as Record<string, string | undefined>;
      if (query.workflow !== undefined && parseGithubId(query.workflow) === null) {
        return reply.badRequest("Invalid workflow filter");
      }
      let pr: number | undefined;
      if (query.pr !== undefined) {
        if (!/^\d{1,8}$/.test(query.pr)) {
          return reply.badRequest("Invalid pr filter");
        }
        pr = Number.parseInt(query.pr, 10);
      }
      const page = query.page !== undefined ? Number.parseInt(query.page, 10) : undefined;
      const perPage =
        query.per_page !== undefined ? Number.parseInt(query.per_page, 10) : undefined;
      if (
        (page !== undefined && (!Number.isInteger(page) || page < 1)) ||
        (perPage !== undefined && (!Number.isInteger(perPage) || perPage < 1))
      ) {
        return reply.badRequest("Invalid pagination");
      }
      return reply.send(
        await listRuns(id, {
          workflow: query.workflow,
          branch: query.branch,
          status: query.status,
          conclusion: query.conclusion,
          pr,
          page,
          perPage,
        }),
      );
    },
  });

  app.get("/repositories/:id/ci/runs/:runId", {
    ...guarded,
    schema: {
      params: runParams,
      response: {
        200: {
          type: "object",
          required: ["run", "jobs", "linkedPrs", "files", "signals"],
          properties: {
            run: runSchema,
            workflow: workflowSchema,
            jobs: {
              type: "array",
              items: {
                type: "object",
                required: ["githubId"],
                properties: {
                  githubId: { type: "string" },
                  name: { type: ["string", "null"] },
                  status: { type: ["string", "null"] },
                  conclusion: { type: ["string", "null"] },
                  startedAt: { type: ["string", "null"] },
                  completedAt: { type: ["string", "null"] },
                  durationSec: { type: ["number", "null"] },
                  htmlUrl: { type: ["string", "null"] },
                },
              },
            },
            commit: {
              type: ["object", "null"],
              required: ["sha"],
              properties: {
                sha: { type: "string" },
                message: { type: ["string", "null"] },
                authorLogin: { type: ["string", "null"] },
              },
            },
            linkedPrs: {
              type: "array",
              items: {
                type: "object",
                required: ["number"],
                properties: {
                  number: { type: "number" },
                  title: { type: ["string", "null"] },
                  state: { type: "string" },
                  merged: { type: "boolean" },
                  via: { type: "string" },
                },
              },
            },
            files: {
              type: "array",
              items: {
                type: "object",
                required: ["path"],
                properties: {
                  path: { type: "string" },
                  windowChanges: { type: "number" },
                  hot: { type: "boolean" },
                },
              },
            },
            riskFindings: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "type", "severity", "title"],
                properties: {
                  id: { type: "string" },
                  type: { type: "string" },
                  severity: { type: "string" },
                  title: { type: "string" },
                },
              },
            },
            relatedIssues: {
              type: "array",
              items: {
                type: "object",
                required: ["number"],
                properties: {
                  number: { type: "number" },
                  title: { type: ["string", "null"] },
                  state: { type: "string" },
                },
              },
            },
            signals: { type: "array", items: signalSchema },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id, runId } = request.params as { id: string; runId: string };
      if (parseGithubId(runId) === null) {
        return reply.badRequest("Invalid run id");
      }
      const detail = await getRunDetail(id, runId);
      if (!detail) {
        return reply.notFound("Workflow run not found");
      }
      return reply.send(detail);
    },
  });

  app.get("/repositories/:id/ci/runs/:runId/analysis", {
    ...guarded,
    schema: {
      params: runParams,
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
                keySignals: {
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
                engineeringContext: {
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
                possibleInvestigationPaths: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["text", "evidenceIds"],
                    properties: {
                      text: { type: "string" },
                      evidenceIds: { type: "array", items: { type: "string" } },
                    },
                  },
                },
                unknowns: { type: "array", items: { type: "string" } },
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
      const { id, runId } = request.params as { id: string; runId: string };
      if (parseGithubId(runId) === null) {
        return reply.badRequest("Invalid run id");
      }
      const detail = await getRunDetail(id, runId);
      if (!detail) {
        return reply.notFound("Workflow run not found");
      }
      return reply.send(await getLatestCiAnalysis(id, runId));
    },
  });

  app.post("/repositories/:id/ci/runs/:runId/analyze", {
    ...guarded,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      params: runParams,
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
      const { id, runId } = request.params as { id: string; runId: string };
      if (parseGithubId(runId) === null) {
        return reply.badRequest("Invalid run id");
      }
      const detail = await getRunDetail(id, runId);
      if (!detail) {
        return reply.notFound("Workflow run not found");
      }
      // Explicit user action only: never triggered by page loads, and the
      // evidence fingerprint cache prevents repeat model calls.
      return reply.send(await requestCiAnalysis(id, runId));
    },
  });
}
