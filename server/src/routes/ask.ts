import type { FastifyInstance } from "fastify";
import {
  requireAuth,
  requireRepositoryAccess,
} from "../middleware/auth.js";
import {
  answerQuestion,
  type AskConversationTurn,
} from "../services/ask.service.js";
import {
  requestAskAnalysis,
  mergeDeterministicWithAi,
} from "../services/ask-analysis.service.js";
import { getAiConfig } from "../services/ai-provider.js";
import { resolveAiConfig } from "../services/ai-registry.js";

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

const askRequestSchema = {
  type: "object",
  required: ["question"],
  properties: {
    question: { type: "string", minLength: 3, maxLength: 500 },
    context: {
      type: ["object", "null"],
      properties: {
        entityType: { type: "string" },
        entityId: { type: "string" },
      },
      required: ["entityType", "entityId"],
    },
    history: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        required: ["question", "evidenceIds"],
        properties: {
          question: { type: "string", maxLength: 500 },
          evidenceIds: { type: "array", items: { type: "string", maxLength: 100 }, maxItems: 30 },
        },
      },
    },
  },
} as const;

const evidenceItemSchema = {
  type: "object",
  required: ["id", "kind", "label", "detail", "entityType", "entityId", "at"],
  properties: {
    id: { type: "string" },
    kind: { type: "string" },
    label: { type: "string" },
    detail: { type: "string" },
    entityType: { type: "string" },
    entityId: { type: "string" },
    at: { type: ["string", "null"] },
  },
} as const;

const entityRefSchema = {
  type: "object",
  required: ["kind", "value", "label"],
  properties: {
    kind: { type: "string" },
    value: { type: "string" },
    label: { type: "string" },
    ambiguous: { type: "boolean" },
    unresolved: { type: "boolean" },
  },
} as const;

const findingSchema = {
  type: "object",
  required: ["text", "evidenceIds"],
  properties: {
    text: { type: "string" },
    evidenceIds: { type: "array", items: { type: "string" } },
  },
} as const;

const windowSchema = {
  type: ["object", "null"],
  properties: {
    label: { type: "string" },
    days: { type: "number" },
    since: { type: "string", format: "date-time" },
  },
  required: ["label", "days", "since"],
} as const;

const askResponseSchema = {
  type: "object",
  required: [
    "question",
    "intent",
    "entities",
    "window",
    "answer",
    "assessment",
    "keyFindings",
    "evidence",
    "unknowns",
    "investigationNextSteps",
    "relatedEntities",
    "metadata",
    "ai",
  ],
  properties: {
    question: { type: "string" },
    intent: { type: "string" },
    entities: { type: "array", items: entityRefSchema },
    window: windowSchema,
    answer: { type: "string" },
    assessment: { type: "string" },
    keyFindings: { type: "array", items: findingSchema },
    evidence: { type: "array", items: evidenceItemSchema },
    unknowns: { type: "array", items: { type: "string" } },
    investigationNextSteps: { type: "array", items: findingSchema },
    relatedEntities: { type: "array", items: entityRefSchema },
    metadata: {
      type: "object",
      required: ["retrievalMs", "evidenceCount", "truncated"],
      properties: {
        retrievalMs: { type: "number" },
        evidenceCount: { type: "number" },
        truncated: { type: "boolean" },
      },
    },
    ai: {
      type: "object",
      required: ["available", "provider", "model", "cached"],
      properties: {
        available: { type: "boolean" },
        provider: { type: ["string", "null"] },
        model: { type: ["string", "null"] },
        cached: { type: "boolean" },
        status: { type: "string" },
        fingerprint: { type: ["string", "null"] },
        error: {
          type: ["object", "null"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
          },
          required: ["code", "message"],
        },
      },
    },
  },
} as const;

export async function askRoutes(app: FastifyInstance): Promise<void> {
  const guarded = {
    preHandler: [requireAuth, requireRepositoryAccess],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  };

  app.post("/repositories/:id/ask", {
    ...guarded,
    schema: {
      params: idParams,
      body: askRequestSchema,
      response: { 200: askResponseSchema },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { question, context, history } = request.body as {
        question: string;
        context?: { entityType: string; entityId: string } | null;
        history?: AskConversationTurn[];
      };

      if (!question || question.trim().length < 3) {
        return reply.badRequest("Question must be at least 3 characters");
      }
      if (question.length > 500) {
        return reply.badRequest("Question must not exceed 500 characters");
      }

      const deterministic = await answerQuestion(id, question.trim(), history ?? []);

      // Resolve user's AI config (user config takes precedence over system config)
      // requireAuth preHandler guarantees request.user exists
      const userId = request.user!.id;
      const aiConfig = await resolveAiConfig(userId);

      const aiResult = await requestAskAnalysis(id, question.trim(), context ?? undefined, history ?? [], aiConfig ?? undefined);

      const merged = mergeDeterministicWithAi(deterministic, aiResult.analysis ?? { aiUnavailable: true });

      const config = getAiConfig();

      return reply.send({
        question: merged.question,
        intent: merged.intent,
        entities: merged.entities,
        window: merged.window,
        answer: merged.answer,
        assessment: merged.assessment,
        keyFindings: merged.keyFindings,
        evidence: merged.evidence,
        unknowns: merged.unknowns,
        investigationNextSteps: merged.investigationNextSteps,
        relatedEntities: merged.relatedEntities,
        metadata: merged.metadata,
        ai: {
          available: aiResult.status === "completed",
          provider: aiConfig?.provider ?? config?.provider ?? null,
          model: aiConfig?.model ?? config?.model ?? null,
          cached: aiResult.cached,
          status: aiResult.status,
          fingerprint: aiResult.fingerprint || null,
          error: aiResult.error,
        },
      });
    },
  });
}