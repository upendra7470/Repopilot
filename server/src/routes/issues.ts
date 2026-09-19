import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  requireAuth,
  requireRepositoryAccess,
} from "../middleware/auth.js";
import {
  computeIssueIntelligence,
  getIssue,
  listIssues,
} from "../services/issue-intelligence.service.js";
import {
  getLatestIssueAnalysis,
  requestIssueAnalysis,
} from "../services/issue-analysis.service.js";

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

const issueNumberParams = {
  type: "object",
  required: ["id", "number"],
  properties: {
    id: { type: "string" },
    number: { type: "string" },
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

const dimensionsSchema = {
  type: "object",
  required: [
    "commentCount",
    "recentCommentCount",
    "linkedPrCount",
    "linkedCommitCount",
    "codeConnected",
    "riskOverlapCount",
    "state",
  ],
  properties: {
    ageDays: { type: ["number", "null"] },
    daysSinceUpdate: { type: ["number", "null"] },
    commentCount: { type: "number" },
    recentCommentCount: { type: "number" },
    linkedPrCount: { type: "number" },
    linkedCommitCount: { type: "number" },
    codeConnected: { type: "boolean" },
    riskOverlapCount: { type: "number" },
    state: { type: "string" },
  },
} as const;

const issueSummarySchema = {
  type: "object",
  required: ["id", "number", "state"],
  properties: {
    id: { type: "string" },
    number: { type: "number" },
    title: { type: ["string", "null"] },
    state: { type: "string" },
    stateReason: { type: ["string", "null"] },
    authorLogin: { type: ["string", "null"] },
    authorAssociation: { type: ["string", "null"] },
    htmlUrl: { type: ["string", "null"] },
    locked: { type: "boolean" },
    commentsCount: { type: "number" },
    labels: { type: "array", items: { type: "string" } },
    milestoneTitle: { type: ["string", "null"] },
    assignees: { type: "array", items: { type: "string" } },
    githubCreatedAt: { type: ["string", "null"] },
    githubUpdatedAt: { type: ["string", "null"] },
    closedAt: { type: ["string", "null"] },
    signals: { type: "array", items: signalSchema },
    dimensions: dimensionsSchema,
  },
} as const;

function parseIssueNumber(raw: string): number | null {
  if (!/^\d{1,8}$/.test(raw)) {
    return null;
  }
  const number = Number.parseInt(raw, 10);
  return number >= 1 ? number : null;
}

/** Detail view extends the summary with the (bounded, untrusted) body. */
const issueDetailSchema = {
  type: "object",
  required: ["id", "number", "state"],
  properties: {
    ...(issueSummarySchema.properties as Record<string, unknown>),
    body: { type: ["string", "null"] },
  },
} as const;

/**
 * Issue intelligence (Phase 9). All routes repository-scoped with
 * ownership checks; issues addressed by number within the repository so
 * records from other repositories cannot leak across.
 */
export async function issueRoutes(app: FastifyInstance): Promise<void> {
  const guarded = {
    preHandler: [requireAuth, requireRepositoryAccess],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  };

  app.get("/repositories/:id/issues", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: {
        type: "object",
        properties: {
          state: { type: "string" },
          label: { type: "string" },
          author: { type: "string" },
          signal: { type: "string" },
          sort: { type: "string" },
          page: { type: "string" },
          per_page: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          required: ["data", "pagination"],
          properties: {
            data: { type: "array", items: issueSummarySchema },
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
      if (
        query.state !== undefined &&
        !["open", "closed", "all"].includes(query.state)
      ) {
        return reply.badRequest("Invalid state filter");
      }
      if (
        query.sort !== undefined &&
        !["updated", "created", "comments", "age"].includes(query.sort)
      ) {
        return reply.badRequest("Invalid sort");
      }
      if (
        query.signal !== undefined &&
        ![
          "stale_open",
          "inactive",
          "high_discussion",
          "recently_active",
          "code_connected",
          "risk_overlap",
          "corrective_context",
        ].includes(query.signal)
      ) {
        return reply.badRequest("Invalid signal filter");
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
        await listIssues(id, {
          state: query.state,
          label: query.label,
          author: query.author,
          signal: query.signal,
          sort: query.sort,
          page,
          perPage,
        }),
      );
    },
  });

  app.get("/repositories/:id/issues/:number", {
    ...guarded,
    schema: {
      params: issueNumberParams,
      response: {
        200: {
          type: "object",
          required: ["issue", "comments", "linkedPrs", "linkedCommits", "files"],
          properties: {
            issue: issueDetailSchema,
            comments: {
              type: "array",
              items: {
                type: "object",
                required: ["githubId"],
                properties: {
                  githubId: { type: "string" },
                  authorLogin: { type: ["string", "null"] },
                  body: { type: ["string", "null"] },
                  githubCreatedAt: { type: ["string", "null"] },
                },
              },
            },
            linkedPrs: {
              type: "array",
              items: {
                type: "object",
                required: ["number", "relation"],
                properties: {
                  number: { type: "number" },
                  title: { type: ["string", "null"] },
                  state: { type: "string" },
                  merged: { type: "boolean" },
                  relation: { type: "string" },
                  evidence: { type: ["string", "null"] },
                },
              },
            },
            linkedCommits: {
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
            files: {
              type: "array",
              items: {
                type: "object",
                required: ["path"],
                properties: {
                  path: { type: "string" },
                  area: { type: "string" },
                  viaCommits: { type: "array", items: { type: "string" } },
                  windowChanges: { type: "number" },
                  hot: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id, number } = request.params as { id: string; number: string };
      const issueNumber = parseIssueNumber(number);
      if (issueNumber === null) {
        return reply.badRequest("Invalid issue number");
      }
      const issue = await getIssue(id, issueNumber);
      if (!issue) {
        return reply.notFound("Issue not found");
      }
      // Single intelligence computation serves detail + relations: one
      // round trip instead of redundant per-section queries.
      const intelligence = await computeIssueIntelligence(id, issueNumber);
      if (!intelligence) {
        return reply.notFound("Issue not found");
      }
      return reply.send({
        issue: { ...issue, signals: intelligence.signals, dimensions: intelligence.dimensions },
        comments: intelligence.recentComments,
        linkedPrs: intelligence.linkedPrs,
        linkedCommits: intelligence.linkedCommits,
        files: intelligence.files,
      });
    },
  });

  app.get("/repositories/:id/issues/:number/intelligence", {
    ...guarded,
    schema: {
      params: issueNumberParams,
      response: {
        200: {
          type: "object",
          required: [
            "signals",
            "dimensions",
            "linkedPrs",
            "linkedCommits",
            "files",
            "riskFindings",
            "recentComments",
          ],
          properties: {
            signals: { type: "array", items: signalSchema },
            dimensions: dimensionsSchema,
            linkedPrs: {
              type: "array",
              items: {
                type: "object",
                required: ["number", "relation"],
                properties: {
                  number: { type: "number" },
                  title: { type: ["string", "null"] },
                  state: { type: "string" },
                  merged: { type: "boolean" },
                  relation: { type: "string" },
                  evidence: { type: ["string", "null"] },
                },
              },
            },
            linkedCommits: {
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
            files: {
              type: "array",
              items: {
                type: "object",
                required: ["path"],
                properties: {
                  path: { type: "string" },
                  area: { type: "string" },
                  viaCommits: { type: "array", items: { type: "string" } },
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
            recentComments: {
              type: "array",
              items: {
                type: "object",
                required: ["githubId"],
                properties: {
                  githubId: { type: "string" },
                  authorLogin: { type: ["string", "null"] },
                  body: { type: ["string", "null"] },
                  githubCreatedAt: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id, number } = request.params as { id: string; number: string };
      const issueNumber = parseIssueNumber(number);
      if (issueNumber === null) {
        return reply.badRequest("Invalid issue number");
      }
      const intelligence = await computeIssueIntelligence(id, issueNumber);
      if (!intelligence) {
        return reply.notFound("Issue not found");
      }
      return reply.send(intelligence);
    },
  });

  app.get("/repositories/:id/issues/:number/analysis", {
    ...guarded,
    schema: {
      params: issueNumberParams,
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
      const { id, number } = request.params as { id: string; number: string };
      const issueNumber = parseIssueNumber(number);
      if (issueNumber === null) {
        return reply.badRequest("Invalid issue number");
      }
      const issue = await getIssue(id, issueNumber);
      if (!issue) {
        return reply.notFound("Issue not found");
      }
      return reply.send(await getLatestIssueAnalysis(id, issueNumber));
    },
  });

  app.post("/repositories/:id/issues/:number/analyze", {
    ...guarded,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      params: issueNumberParams,
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
      const { id, number } = request.params as { id: string; number: string };
      const parsed = z.coerce.number().int().min(1).safeParse(number);
      if (!parsed.success) {
        return reply.badRequest("Invalid issue number");
      }
      const issue = await getIssue(id, parsed.data);
      if (!issue) {
        return reply.notFound("Issue not found");
      }
      // Explicit user action only: never triggered by page loads, and the
      // evidence fingerprint cache prevents repeat model calls.
      return reply.send(await requestIssueAnalysis(id, parsed.data));
    },
  });
}
