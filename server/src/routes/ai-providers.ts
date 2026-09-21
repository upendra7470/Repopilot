import type { FastifyInstance } from "fastify";
import {
  requireAuth,
} from "../middleware/auth.js";
import {
  listKnownProviders,
  getProviderMetadata,
  testAiProvider,
  saveUserAiProvider,
  setActiveAiProvider,
  getUserAiProviders,
  deleteUserAiProvider,
  createAdapter,
} from "../services/ai-registry.js";

const providerParamSchema = {
  type: "object",
  required: ["provider"],
  properties: { provider: { type: "string" } },
} as const;

const aiProviderBodySchema = {
  type: "object",
  required: ["provider", "model", "apiKey"],
  properties: {
    provider: { type: "string" },
    model: { type: "string" },
    baseUrl: { type: ["string", "null"] },
    apiKey: { type: ["string", "null"] },
  },
} as const;

const testBodySchema = {
  type: "object",
  required: ["model", "baseUrl", "apiKey"],
  properties: {
    model: { type: "string" },
    baseUrl: { type: "string" },
    apiKey: { type: ["string", "null"] },
  },
} as const;

const modelsBodySchema = {
  type: "object",
  required: ["baseUrl", "apiKey"],
  properties: {
    baseUrl: { type: "string" },
    apiKey: { type: ["string", "null"] },
  },
} as const;

export async function aiProviderRoutes(app: FastifyInstance): Promise<void> {
  const guarded = {
    preHandler: [requireAuth],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  };

  // List known providers (metadata)
  app.get("/ai-providers/known", {
    ...guarded,
    schema: {
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "name", "description", "supportsModelListing", "defaultBaseUrl", "defaultModel"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string" },
              supportsModelListing: { type: "boolean" },
              defaultBaseUrl: { type: "string" },
              defaultModel: { type: "string" },
            },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      const providers = listKnownProviders();
      return reply.send(providers);
    },
  });

  // List user's configured providers
  app.get("/ai-providers", {
    ...guarded,
    schema: {
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "provider", "model", "baseUrl", "isActive", "createdAt", "updatedAt"],
            properties: {
              id: { type: "string" },
              provider: { type: "string" },
              model: { type: "string" },
              baseUrl: { type: ["string", "null"] },
              isActive: { type: "boolean" },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = request.user!.id;
      const providers = await getUserAiProviders(userId);
      return reply.send(providers);
    },
  });

  // Create or update a provider configuration
  app.post("/ai-providers", {
    ...guarded,
    schema: {
      body: aiProviderBodySchema,
      response: {
        200: {
          type: "object",
          required: ["success"],
          properties: {
            success: { type: "boolean" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = request.user!.id;
      const { provider, model, baseUrl, apiKey } = request.body as {
        provider: string;
        model: string;
        baseUrl: string;
        apiKey: string | null;
      };

      // Validate provider is known
      const metadata = getProviderMetadata(provider);
      if (!metadata) {
        return reply.badRequest("Unknown provider");
      }

      // Validate baseUrl is a valid URL if provided
      if (baseUrl) {
        try {
          new URL(baseUrl);
        } catch {
          return reply.badRequest("Invalid baseUrl");
        }
      }

      await saveUserAiProvider(userId, provider, model, baseUrl || null, apiKey);
      return reply.send({ success: true });
    },
  });

  // Test a provider configuration (without saving)
  app.post("/ai-providers/:provider/test", {
    ...guarded,
    schema: {
      params: providerParamSchema,
      body: testBodySchema,
      response: {
        200: {
          type: "object",
          required: ["success", "latencyMs"],
          properties: {
            success: { type: "boolean" },
            model: { type: ["string", "null"] },
            latencyMs: { type: "number" },
            error: { type: ["string", "null"] },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { provider } = request.params as { provider: string };
      const { model, baseUrl, apiKey } = request.body as {
        model: string;
        baseUrl: string;
        apiKey: string | null;
      };

      const metadata = getProviderMetadata(provider);
      if (!metadata) {
        return reply.badRequest("Unknown provider");
      }

      const result = await testAiProvider({ provider, model, baseUrl, apiKey });
      return reply.send({
        success: result.success,
        model: result.success ? model : null,
        latencyMs: result.latencyMs,
        error: result.error ?? null,
      });
    },
  });

  // List models for a provider (if supported)
  app.post("/ai-providers/:provider/models", {
    ...guarded,
    schema: {
      params: providerParamSchema,
      body: modelsBodySchema,
      response: {
        200: {
          type: "object",
          required: ["models"],
          properties: {
            models: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { provider } = request.params as { provider: string };
      const { baseUrl, apiKey } = request.body as { baseUrl: string; apiKey: string | null };

      const metadata = getProviderMetadata(provider);
      if (!metadata) {
        return reply.badRequest("Unknown provider");
      }
      if (!metadata.supportsModelListing) {
        return reply.send({ models: [] });
      }

      try {
        const adapter = createAdapter({ provider, model: "", baseUrl, apiKey });
        const models = await adapter.listModels?.({ baseUrl, apiKey }) ?? [];
        return reply.send({ models });
      } catch (err) {
        return reply.send({ models: [] });
      }
    },
  });

  // Set a provider as active
  app.post("/ai-providers/:provider/active", {
    ...guarded,
    schema: {
      params: providerParamSchema,
      response: {
        200: {
          type: "object",
          required: ["success"],
          properties: {
            success: { type: "boolean" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = request.user!.id;
      const { provider } = request.params as { provider: string };

      const metadata = getProviderMetadata(provider);
      if (!metadata) {
        return reply.badRequest("Unknown provider");
      }

      await setActiveAiProvider(userId, provider);
      return reply.send({ success: true });
    },
  });

  // Delete a provider configuration
  app.delete("/ai-providers/:provider", {
    ...guarded,
    schema: {
      params: providerParamSchema,
      response: {
        200: {
          type: "object",
          required: ["success"],
          properties: {
            success: { type: "boolean" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = request.user!.id;
      const { provider } = request.params as { provider: string };

      await deleteUserAiProvider(userId, provider);
      return reply.send({ success: true });
    },
  });
}