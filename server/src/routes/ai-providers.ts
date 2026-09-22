import type { FastifyInstance } from "fastify";
import {
  requireAuth,
} from "../middleware/auth.js";
import {
  listKnownProviders,
  getProviderMetadata,
  testAiProvider,
  testConnection,
  validateOutboundBaseUrl,
  discoverModels,
  discoverModelsWithSavedCredentials,
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

const discoverBodySchema = {
  type: "object",
  required: ["provider", "apiKey"],
  properties: {
    provider: { type: "string", maxLength: 100 },
    apiKey: { type: ["string", "null"], maxLength: 10000 },
    baseUrl: { type: "string", maxLength: 2000 },
    refresh: { type: "boolean" },
  },
} as const;

const discoveredModelSchema = {
  type: "object",
  required: ["id", "provider"],
  properties: {
    id: { type: "string" },
    displayName: { type: "string" },
    provider: { type: "string" },
    contextWindow: { type: "number" },
  },
} as const;

const discoverResponseSchema = {
  type: "object",
  required: ["models", "error", "cached"],
  properties: {
    models: { type: "array", items: discoveredModelSchema },
    error: { type: ["string", "null"] },
    cached: { type: "boolean" },
  },
} as const;

const testConnectionBodySchema = {
  type: "object",
  required: ["provider", "apiKey"],
  properties: {
    provider: { type: "string", maxLength: 100 },
    apiKey: { type: ["string", "null"], maxLength: 10000 },
    baseUrl: { type: "string", maxLength: 2000 },
  },
} as const;

const capabilitiesSchema = {
  type: "object",
  required: ["modelDiscovery", "connectionTest", "structuredOutput", "streaming"],
  properties: {
    modelDiscovery: { type: "boolean" },
    connectionTest: { type: "boolean" },
    structuredOutput: { type: "boolean" },
    streaming: { type: "boolean" },
  },
} as const;

export async function aiProviderRoutes(app: FastifyInstance): Promise<void> {
  const guarded = {
    preHandler: [requireAuth],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  };

  // List known providers (metadata + honest capability flags)
  app.get("/ai-providers/known", {
    ...guarded,
    schema: {
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "name", "description", "supportsModelListing", "protocol", "capabilities", "defaultBaseUrl", "defaultModel"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string" },
              supportsModelListing: { type: "boolean" },
              protocol: { type: "string" },
              capabilities: capabilitiesSchema,
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

      // Validate baseUrl if provided (scheme, credentials, blocked targets)
      if (baseUrl) {
        const baseUrlError = await validateOutboundBaseUrl(baseUrl);
        if (baseUrlError) {
          return reply.badRequest(baseUrlError);
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
      if (await validateOutboundBaseUrl(baseUrl)) {
        return reply.send({ models: [] });
      }

      try {
        const adapter = createAdapter({ provider, model: "", baseUrl, apiKey });
        const models = await adapter.listModels?.({ baseUrl, apiKey }) ?? [];
        return reply.send({ models });
      } catch {
        return reply.send({ models: [] });
      }
    },
  });

  // Discover available models for a provider (Cline/OpenCode-style selector).
  // Uses unsaved credentials supplied in the body: nothing is persisted.
  // Always responds 200 for known providers: upstream auth, rate-limit, and
  // transport failures are reported via the `error` field, never thrown.
  app.post("/ai-providers/discover-models", {
    ...guarded,
    schema: {
      body: discoverBodySchema,
      response: { 200: discoverResponseSchema },
    },
    handler: async (request, reply) => {
      const userId = request.user!.id;
      const { provider, apiKey, baseUrl, refresh } = request.body as {
        provider: string;
        apiKey: string | null;
        baseUrl?: string;
        refresh?: boolean;
      };

      const metadata = getProviderMetadata(provider);
      if (!metadata) {
        return reply.badRequest("Unknown provider");
      }

      const result = await discoverModels({
        provider,
        baseUrl: baseUrl ?? null,
        apiKey,
        userId,
        refresh,
      });
      return reply.send({ models: result.models, error: result.error, cached: result.cached });
    },
  });

  // Refresh the model catalog using SAVED credentials. The key is decrypted
  // server-side only and never returned to the client.
  app.post("/ai-providers/:provider/refresh-models", {
    ...guarded,
    schema: {
      params: providerParamSchema,
      body: {
        type: "object",
        properties: {
          refresh: { type: "boolean" },
        },
      } as const,
      response: { 200: discoverResponseSchema },
    },
    handler: async (request, reply) => {
      const userId = request.user!.id;
      const { provider } = request.params as { provider: string };
      const { refresh } = (request.body ?? {}) as { refresh?: boolean };

      const metadata = getProviderMetadata(provider);
      if (!metadata) {
        return reply.badRequest("Unknown provider");
      }

      const result = await discoverModelsWithSavedCredentials(userId, provider, { refresh });
      if (!result) {
        return reply.notFound("No saved configuration for this provider");
      }
      return reply.send({ models: result.models, error: result.error, cached: result.cached });
    },
  });

  // Test Connection: can RepoPilot authenticate? Validates credentials only —
  // no model completion is attempted, so no model tokens are spent.
  app.post("/ai-providers/test-connection", {
    ...guarded,
    schema: {
      body: testConnectionBodySchema,
      response: {
        200: {
          type: "object",
          required: ["success", "latencyMs"],
          properties: {
            success: { type: "boolean" },
            latencyMs: { type: "number" },
            error: { type: ["string", "null"] },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { provider, apiKey, baseUrl } = request.body as {
        provider: string;
        apiKey: string | null;
        baseUrl?: string;
      };

      const metadata = getProviderMetadata(provider);
      if (!metadata) {
        return reply.badRequest("Unknown provider");
      }

      const result = await testConnection({ provider, baseUrl: baseUrl ?? null, apiKey });
      return reply.send({
        success: result.success,
        latencyMs: result.latencyMs,
        error: result.error ?? null,
      });
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