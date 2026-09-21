import type { FastifyInstance } from "fastify";
import {
  requireAuth,
  requireRepositoryAccess,
} from "../middleware/auth.js";
import { buildInvestigationContext, normalizeInvestigationType, type InvestigationTarget } from "../services/investigation.service.js";

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

const investigationQuerySchema = {
  type: "object",
  properties: {
    entityType: {
      type: "string",
      enum: ["commit", "file", "pull_request", "issue", "ci_run", "ci_workflow", "incident", "risk"],
    },
    entityId: { type: "string" },
  },
  required: ["entityType", "entityId"],
} as const;

const commitRefSchema = {
  type: "object",
  required: ["sha", "shortSha", "message", "authorLogin", "committedAt", "url"],
  properties: {
    sha: { type: "string" },
    shortSha: { type: "string" },
    message: { type: ["string", "null"] },
    authorLogin: { type: ["string", "null"] },
    committedAt: { type: ["string", "null"], format: "date-time" },
    url: { type: ["string", "null"] },
  },
} as const;

const fileRefSchema = {
  type: "object",
  required: ["path", "area", "changeCount", "recentChanges", "hot", "contributors", "linkedCommits", "linkedPrs", "linkedIssues"],
  properties: {
    path: { type: "string" },
    area: { type: "string" },
    changeCount: { type: "number" },
    recentChanges: { type: "number" },
    hot: { type: "boolean" },
    contributors: { type: "array", items: { type: "string" } },
    linkedCommits: { type: "array", items: { type: "string" } },
    linkedPrs: { type: "array", items: { type: "number" } },
    linkedIssues: { type: "array", items: { type: "number" } },
  },
} as const;

const prRefSchema = {
  type: "object",
  required: ["id", "number", "title", "state", "merged", "authorLogin", "sourceBranch", "targetBranch", "headSha", "files", "commits", "githubCreatedAt", "githubUpdatedAt", "htmlUrl"],
  properties: {
    id: { type: "string" },
    number: { type: "number" },
    title: { type: ["string", "null"] },
    state: { type: "string" },
    merged: { type: "boolean" },
    authorLogin: { type: ["string", "null"] },
    sourceBranch: { type: ["string", "null"] },
    targetBranch: { type: ["string", "null"] },
    headSha: { type: ["string", "null"] },
    files: { type: "array", items: { type: "string" } },
    commits: { type: "array", items: { type: "string" } },
    githubCreatedAt: { type: ["string", "null"], format: "date-time" },
    githubUpdatedAt: { type: ["string", "null"], format: "date-time" },
    htmlUrl: { type: ["string", "null"] },
  },
} as const;

const issueRefSchema = {
  type: "object",
  required: ["number", "title", "state", "authorLogin", "linkedPrs", "linkedCommits", "files", "githubCreatedAt", "githubUpdatedAt", "htmlUrl"],
  properties: {
    number: { type: "number" },
    title: { type: ["string", "null"] },
    state: { type: "string" },
    authorLogin: { type: ["string", "null"] },
    linkedPrs: { type: "array", items: { type: "number" } },
    linkedCommits: { type: "array", items: { type: "string" } },
    files: { type: "array", items: { type: "string" } },
    githubCreatedAt: { type: ["string", "null"], format: "date-time" },
    githubUpdatedAt: { type: ["string", "null"], format: "date-time" },
    htmlUrl: { type: ["string", "null"] },
  },
} as const;

const runRefSchema = {
  type: "object",
  required: ["githubId", "runNumber", "name", "status", "conclusion", "headBranch", "headSha", "workflowName", "workflowGithubId", "githubCreatedAt", "htmlUrl", "prNumbers"],
  properties: {
    githubId: { type: "string" },
    runNumber: { type: ["number", "null"] },
    name: { type: ["string", "null"] },
    status: { type: ["string", "null"] },
    conclusion: { type: ["string", "null"] },
    headBranch: { type: ["string", "null"] },
    headSha: { type: ["string", "null"] },
    workflowName: { type: ["string", "null"] },
    workflowGithubId: { type: ["string", "null"] },
    githubCreatedAt: { type: ["string", "null"], format: "date-time" },
    htmlUrl: { type: ["string", "null"] },
    prNumbers: { type: "array", items: { type: "number" } },
  },
} as const;

const workflowRefSchema = {
  type: "object",
  required: ["id", "githubId", "name", "path", "state"],
  properties: {
    id: { type: "string" },
    githubId: { type: "string" },
    name: { type: ["string", "null"] },
    path: { type: ["string", "null"] },
    state: { type: ["string", "null"] },
  },
} as const;

const riskRefSchema = {
  type: "object",
  required: ["id", "type", "severity", "title", "summary", "affectedFiles", "affectedContributors"],
  properties: {
    id: { type: "string" },
    type: { type: "string" },
    severity: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    affectedFiles: { type: "array", items: { type: "string" } },
    affectedContributors: { type: "array", items: { type: "string" } },
  },
} as const;

const incidentRefSchema = {
  type: "object",
  required: ["fingerprint", "title", "status", "severity", "workflowGithubId", "workflowName", "branch", "burstLength", "burstStartAt", "burstEndAt", "filePaths", "linkedPrNumbers", "linkedIssueNumbers", "riskFindingIds", "evidence", "timeline", "contributorLogins"],
  properties: {
    fingerprint: { type: "string" },
    title: { type: "string" },
    status: { type: "string" },
    severity: { type: "string" },
    workflowGithubId: { type: "string" },
    workflowName: { type: ["string", "null"] },
    branch: { type: "string" },
    burstLength: { type: "number" },
    burstStartAt: { type: ["string", "null"], format: "date-time" },
    burstEndAt: { type: ["string", "null"], format: "date-time" },
    filePaths: { type: "array", items: { type: "string" } },
    linkedPrNumbers: { type: "array", items: { type: "number" } },
    linkedIssueNumbers: { type: "array", items: { type: "number" } },
    riskFindingIds: { type: "array", items: { type: "string" } },
    evidence: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "value", "label"],
        properties: {
          kind: { type: "string" },
          value: { type: "string" },
          label: { type: "string" },
        },
      },
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        required: ["at", "kind", "title", "detail", "ref"],
        properties: {
          at: { type: ["string", "null"], format: "date-time" },
          kind: { type: "string" },
          title: { type: "string" },
          detail: { type: ["string", "null"] },
          ref: {
            type: "object",
            required: ["kind", "value", "label"],
            properties: {
              kind: { type: "string" },
              value: { type: "string" },
              label: { type: "string" },
            },
          },
        },
      },
    },
    contributorLogins: { type: "array", items: { type: "string" } },
  },
} as const;

const contributorRefSchema = {
  type: "object",
  required: ["login", "name", "commitCount", "filesTouched"],
  properties: {
    login: { type: "string" },
    name: { type: ["string", "null"] },
    commitCount: { type: "number" },
    filesTouched: { type: "array", items: { type: "string" } },
  },
} as const;

const incidentTimelineEntrySchema = {
  type: "object",
  required: ["at", "kind", "title", "detail", "ref"],
  properties: {
    at: { type: ["string", "null"], format: "date-time" },
    kind: { type: "string" },
    title: { type: "string" },
    detail: { type: ["string", "null"] },
    ref: {
      type: "object",
      required: ["kind", "value", "label"],
      properties: {
        kind: { type: "string" },
        value: { type: "string" },
        label: { type: "string" },
      },
    },
  },
} as const;

const ciFailurePatternSchema = {
  type: "object",
  required: ["workflowGithubId", "workflowName", "branch", "failureCount", "streakLength", "lastFailureAt", "runs"],
  properties: {
    workflowGithubId: { type: "string" },
    workflowName: { type: ["string", "null"] },
    branch: { type: "string" },
    failureCount: { type: "number" },
    streakLength: { type: "number" },
    lastFailureAt: { type: ["string", "null"], format: "date-time" },
    runs: { type: "array", items: runRefSchema },
  },
} as const;

const riskyFilePatternSchema = {
  type: "object",
  required: ["path", "riskCount", "incidentCount", "totalChanges", "severity"],
  properties: {
    path: { type: "string" },
    riskCount: { type: "number" },
    incidentCount: { type: "number" },
    totalChanges: { type: "number" },
    severity: { type: "string" },
  },
} as const;

const incidentAreaPatternSchema = {
  type: "object",
  required: ["workflowGithubId", "workflowName", "branch", "incidentCount", "fileOverlap"],
  properties: {
    workflowGithubId: { type: "string" },
    workflowName: { type: ["string", "null"] },
    branch: { type: "string" },
    incidentCount: { type: "number" },
    fileOverlap: { type: "array", items: { type: "string" } },
  },
} as const;

const directRelationshipsSchema = {
  type: "object",
  required: ["commits", "files", "prs", "issues", "runs", "workflows", "risks", "incidents", "contributors"],
  properties: {
    commits: { type: "array", items: commitRefSchema },
    files: { type: "array", items: fileRefSchema },
    prs: { type: "array", items: prRefSchema },
    issues: { type: "array", items: issueRefSchema },
    runs: { type: "array", items: runRefSchema },
    workflows: { type: "array", items: workflowRefSchema },
    risks: { type: "array", items: riskRefSchema },
    incidents: { type: "array", items: incidentRefSchema },
    contributors: { type: "array", items: contributorRefSchema },
  },
} as const;

const temporalRelationshipsSchema = {
  type: "object",
  required: ["changesBefore", "changesAfter", "incidentTimeline"],
  properties: {
    changesBefore: { type: "array", items: commitRefSchema },
    changesAfter: { type: "array", items: commitRefSchema },
    incidentTimeline: { type: "array", items: incidentTimelineEntrySchema },
  },
} as const;

const repeatedPatternsSchema = {
  type: "object",
  required: ["repeatedCiFailures", "repeatedRiskyFiles", "repeatedIncidentAreas"],
  properties: {
    repeatedCiFailures: { type: "array", items: ciFailurePatternSchema },
    repeatedRiskyFiles: { type: "array", items: riskyFilePatternSchema },
    repeatedIncidentAreas: { type: "array", items: incidentAreaPatternSchema },
  },
} as const;

const evidencePackageSchema = {
  type: "object",
  required: ["commits", "files", "prs", "issues", "runs", "workflows", "risks", "incidents", "contributors"],
  properties: {
    commits: { type: "array", items: commitRefSchema },
    files: { type: "array", items: fileRefSchema },
    prs: { type: "array", items: prRefSchema },
    issues: { type: "array", items: issueRefSchema },
    runs: { type: "array", items: runRefSchema },
    workflows: { type: "array", items: workflowRefSchema },
    risks: { type: "array", items: riskRefSchema },
    incidents: { type: "array", items: incidentRefSchema },
    contributors: { type: "array", items: contributorRefSchema },
  },
} as const;

const investigationTargetSchema = {
  type: "object",
  required: ["type", "identifier"],
  properties: {
    type: { type: "string", enum: ["commit", "file", "pull_request", "issue", "ci_run", "ci_workflow", "incident", "risk"] },
    identifier: { type: "string" },
  },
} as const;

const investigationResponseSchema = {
  type: "object",
  required: ["target", "directRelationships", "temporalRelationships", "repeatedPatterns", "evidence", "unknowns", "summaryMetadata"],
  properties: {
    target: investigationTargetSchema,
    directRelationships: directRelationshipsSchema,
    temporalRelationships: temporalRelationshipsSchema,
    repeatedPatterns: repeatedPatternsSchema,
    evidence: evidencePackageSchema,
    unknowns: { type: "array", items: { type: "string" } },
    summaryMetadata: {
      type: "object",
      required: ["totalEvidenceItems", "truncated", "retrievalMs"],
      properties: {
        totalEvidenceItems: { type: "number" },
        truncated: { type: "boolean" },
        retrievalMs: { type: "number" },
      },
    },
  },
} as const;

export async function investigationRoutes(app: FastifyInstance): Promise<void> {
  const guarded = {
    preHandler: [requireAuth, requireRepositoryAccess],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  };

  app.get("/repositories/:id/investigation", {
    ...guarded,
    schema: {
      params: idParams,
      querystring: investigationQuerySchema,
      response: { 200: investigationResponseSchema },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as {
        entityType: string;
        entityId: string;
      };

      const validEntityTypes = [
        "commit",
        "file",
        "pull_request",
        "issue",
        "ci_run",
        "ci_workflow",
        "incident",
        "risk",
      ] as const;

      if (!validEntityTypes.includes(query.entityType as typeof validEntityTypes[number])) {
        return reply.badRequest("Invalid entityType");
      }

      const normalizedType = normalizeInvestigationType(query.entityType);
      if (!normalizedType) {
        return reply.badRequest(`Invalid entityType: ${query.entityType}`);
      }

      const target: InvestigationTarget = {
        type: normalizedType,
        identifier: query.entityId,
      };

      try {
        const started = Date.now();
        const context = await buildInvestigationContext(id, target);
        const retrievalMs = Date.now() - started;

        const totalEvidenceItems =
          context.evidence.commits.length +
          context.evidence.files.length +
          context.evidence.prs.length +
          context.evidence.issues.length +
          context.evidence.runs.length +
          context.evidence.workflows.length +
          context.evidence.risks.length +
          context.evidence.incidents.length +
          context.evidence.contributors.length;

        return reply.send({
          target: context.target,
          directRelationships: context.directRelationships,
          temporalRelationships: context.temporalRelationships,
          repeatedPatterns: context.repeatedPatterns,
          evidence: context.evidence,
          unknowns: context.unknowns,
          summaryMetadata: {
            totalEvidenceItems,
            truncated: totalEvidenceItems > 450,
            retrievalMs,
          },
        });
      } catch (err) {
        const logger = (await import("../utils/logger.js")).getLogger();
        logger.error({ err, repositoryId: id, target: query.entityType }, "Investigation build failed");
        if (err instanceof Error && err.message === "Repository not found") {
          return reply.notFound("Repository not found");
        }
        return reply.internalServerError("Failed to build investigation context");
      }
    },
  });
}