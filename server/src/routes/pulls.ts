import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  requireAuth,
  requireRepositoryAccess,
} from "../middleware/auth.js";
import {
  computePrIntelligence,
  getPullRequest,
  listPullRequests,
} from "../services/pr-intelligence.service.js";
import {
  getLatestPrAnalysis,
  requestPrAnalysis,
} from "../services/pr-analysis.service.js";
import { getDb } from "../db/index.js";
import { commits, prCommits, prFiles } from "../db/schema.js";
import { desc, eq } from "drizzle-orm";

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

const prNumberParams = {
  type: "object",
  required: ["id", "number"],
  properties: {
    id: { type: "string" },
    number: { type: "string" },
  },
} as const;

const prSummarySchema = {
  type: "object",
  required: ["id", "number", "state"],
  properties: {
    id: { type: "string" },
    number: { type: "number" },
    title: { type: ["string", "null"] },
    state: { type: "string" },
    draft: { type: "boolean" },
    merged: { type: "boolean" },
    authorLogin: { type: ["string", "null"] },
    sourceBranch: { type: ["string", "null"] },
    targetBranch: { type: ["string", "null"] },
    additions: { type: ["number", "null"] },
    deletions: { type: ["number", "null"] },
    changedFilesCount: { type: ["number", "null"] },
    htmlUrl: { type: ["string", "null"] },
    githubCreatedAt: { type: ["string", "null"] },
    githubUpdatedAt: { type: ["string", "null"] },
    mergedAt: { type: ["string", "null"] },
  },
} as const;

function parsePrNumber(raw: string): number | null {
  if (!/^\d{1,8}$/.test(raw)) {
    return null;
  }
  const number = Number.parseInt(raw, 10);
  return number >= 1 ? number : null;
}

/**
 * Pull request intelligence (Phase 8). All routes repository-scoped with
 * ownership checks; PRs addressed by number within the repository so IDs
 * from other repositories cannot leak across.
 */
export async function pullRequestRoutes(app: FastifyInstance): Promise<void> {
  const guarded = {
    preHandler: [requireAuth, requireRepositoryAccess],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  };

  app.get("/repositories/:id/pulls", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: {
        type: "object",
        properties: { state: { type: "string" } },
      },
      response: {
        200: { type: "array", items: prSummarySchema },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { state } = request.query as { state?: string };
      if (state !== undefined && !["open", "closed", "merged", "all"].includes(state)) {
        return reply.badRequest("Invalid state filter");
      }
      return reply.send(await listPullRequests(id, state));
    },
  });

  app.get("/repositories/:id/pulls/:number", {
    ...guarded,
    schema: {
      params: prNumberParams,
      response: {
        200: {
          type: "object",
          required: ["pr", "files", "commits"],
          properties: {
            pr: prSummarySchema,
            files: {
              type: "array",
              items: {
                type: "object",
                required: ["path"],
                properties: {
                  path: { type: "string" },
                  previousPath: { type: ["string", "null"] },
                  sha: { type: ["string", "null"] },
                  status: { type: ["string", "null"] },
                  additions: { type: ["number", "null"] },
                  deletions: { type: ["number", "null"] },
                  changes: { type: ["number", "null"] },
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
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id, number } = request.params as { id: string; number: string };
      const prNumber = parsePrNumber(number);
      if (prNumber === null) {
        return reply.badRequest("Invalid pull request number");
      }
      const db = getDb();
      const pr = await getPullRequest(id, prNumber);
      if (!pr) {
        return reply.notFound("Pull request not found");
      }
      const [fileRows, commitRows] = await Promise.all([
        db.select().from(prFiles).where(eq(prFiles.pullRequestId, pr.id)),
        db
          .select({
            sha: commits.sha,
            message: commits.message,
            authorLogin: commits.authorLogin,
            committedAt: commits.committedAt,
          })
          .from(prCommits)
          .innerJoin(commits, eq(prCommits.commitId, commits.id))
          .where(eq(prCommits.pullRequestId, pr.id))
          .orderBy(desc(commits.committedAt)),
      ]);
      return reply.send({
        pr: {
          id: pr.id,
          number: pr.number,
          title: pr.title,
          state: pr.state,
          draft: pr.draft,
          merged: pr.merged,
          authorLogin: pr.authorLogin,
          sourceBranch: pr.sourceBranch,
          targetBranch: pr.targetBranch,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFilesCount: pr.changedFilesCount,
          htmlUrl: pr.htmlUrl,
          githubCreatedAt: pr.githubCreatedAt,
          githubUpdatedAt: pr.githubUpdatedAt,
          mergedAt: pr.mergedAt,
        },
        files: fileRows.map((f) => ({
          path: f.path,
          previousPath: f.previousPath,
          sha: f.sha,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          changes: f.changes,
        })),
        commits: commitRows,
      });
    },
  });

  app.get("/repositories/:id/pulls/:number/intelligence", {
    ...guarded,
    schema: {
      params: prNumberParams,
      response: {
        200: {
          type: "object",
          required: ["signals", "stats", "areas", "files", "commits", "riskFindings"],
          properties: {
            signals: {
              type: "array",
              items: {
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
              },
            },
            stats: {
              type: "object",
              required: ["commits"],
              properties: {
                additions: { type: ["number", "null"] },
                deletions: { type: ["number", "null"] },
                changedFiles: { type: ["number", "null"] },
                commits: { type: "number" },
                contributors: { type: "array", items: { type: "string" } },
              },
            },
            areas: {
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
            files: {
              type: "array",
              items: {
                type: "object",
                required: ["path"],
                properties: {
                  path: { type: "string" },
                  status: { type: ["string", "null"] },
                  additions: { type: ["number", "null"] },
                  deletions: { type: ["number", "null"] },
                  windowChanges: { type: "number" },
                  hot: { type: "boolean" },
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
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id, number } = request.params as { id: string; number: string };
      const prNumber = parsePrNumber(number);
      if (prNumber === null) {
        return reply.badRequest("Invalid pull request number");
      }
      const intelligence = await computePrIntelligence(id, prNumber);
      if (!intelligence) {
        return reply.notFound("Pull request not found");
      }
      return reply.send(intelligence);
    },
  });

  app.get("/repositories/:id/pulls/:number/analysis", {
    ...guarded,
    schema: {
      params: prNumberParams,
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
              required: ["summary", "riskLevel"],
              properties: {
                summary: { type: "string" },
                riskLevel: { type: "string" },
                keyChanges: { type: "array", items: { type: "string" } },
                riskFactors: {
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
                reviewFocus: { type: "array", items: { type: "string" } },
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
      const prNumber = parsePrNumber(number);
      if (prNumber === null) {
        return reply.badRequest("Invalid pull request number");
      }
      const pr = await getPullRequest(id, prNumber);
      if (!pr) {
        return reply.notFound("Pull request not found");
      }
      return reply.send(await getLatestPrAnalysis(id, prNumber));
    },
  });

  app.post("/repositories/:id/pulls/:number/analyze", {
    ...guarded,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      params: prNumberParams,
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
        return reply.badRequest("Invalid pull request number");
      }
      const pr = await getPullRequest(id, parsed.data);
      if (!pr) {
        return reply.notFound("Pull request not found");
      }
      // Explicit user action only: never triggered by page loads, and the
      // evidence fingerprint cache prevents repeat model calls.
      return reply.send(await requestPrAnalysis(id, parsed.data));
    },
  });
}
