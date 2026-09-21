import { getLogger } from "../utils/logger.js";
import {
  getAiConfig,
  type AiConfig,
  AiError,
} from "./ai-provider.js";
export type { AiConfig };
import { encryptSecret, decryptSecret, type EncryptedSecret } from "../auth/crypto.js";
import { getDb } from "../db/index.js";
import { userAiProviders } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export interface ProviderMetadata {
  id: string;
  name: string;
  description: string;
  supportsModelListing: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
}

export const KNOWN_PROVIDERS: Record<string, ProviderMetadata> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI API (GPT-4, GPT-3.5, etc.)",
    supportsModelListing: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    description: "Anthropic API (Claude models) - native protocol",
    supportsModelListing: false,
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-sonnet-latest",
  },
  mistral: {
    id: "mistral",
    name: "Mistral",
    description: "Mistral AI API - OpenAI-compatible",
    supportsModelListing: true,
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
  },
  groq: {
    id: "groq",
    name: "Groq",
    description: "Groq API - OpenAI-compatible",
    supportsModelListing: true,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.1-70b-versatile",
  },
  together: {
    id: "together",
    name: "Together AI",
    description: "Together AI - OpenAI-compatible",
    supportsModelListing: true,
    defaultBaseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
  },
  fireworks: {
    id: "fireworks",
    name: "Fireworks AI",
    description: "Fireworks AI - OpenAI-compatible",
    supportsModelListing: true,
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct",
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    description: "Cerebras Inference - OpenAI-compatible",
    supportsModelListing: true,
    defaultBaseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama3.1-70b",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    description: "OpenRouter - OpenAI-compatible gateway",
    supportsModelListing: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/auto",
  },
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    description: "Local Ollama server - OpenAI-compatible",
    supportsModelListing: true,
    defaultBaseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.1",
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio (Local)",
    description: "Local LM Studio server - OpenAI-compatible",
    supportsModelListing: true,
    defaultBaseUrl: "http://localhost:1234/v1",
    defaultModel: "default",
  },
  custom: {
    id: "custom",
    name: "Custom OpenAI-Compatible",
    description: "Any OpenAI-compatible endpoint",
    supportsModelListing: false,
    defaultBaseUrl: "",
    defaultModel: "",
  },
};

export interface ProviderAdapter {
  completeChat(options: {
    system: string;
    user: string;
    maxTokens?: number;
    timeoutMs?: number;
  }): Promise<string>;
  listModels?(config: { baseUrl: string; apiKey: string | null }): Promise<string[]>;
  validateCredentials(config: { baseUrl: string; apiKey: string | null }): Promise<{ valid: boolean; error?: string }>;
}

/**
 * Generic OpenAI-compatible adapter.
 * Works with any OpenAI-compatible endpoint.
 */
export class OpenAICompatibleAdapter implements ProviderAdapter {
  private config: { baseUrl: string; apiKey: string | null; model: string };

  constructor(config: { baseUrl: string; apiKey: string | null; model: string }) {
    this.config = config;
  }

  async completeChat(options: {
    system: string;
    user: string;
    maxTokens?: number;
    timeoutMs?: number;
  }): Promise<string> {
    const logger = getLogger();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 60_000,
    );
    try {
      let res: Response;
      try {
        res = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.config.model,
            temperature: 0,
            max_tokens: options.maxTokens ?? 2000,
            messages: [
              { role: "system", content: options.system },
              { role: "user", content: options.user },
            ],
          }),
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new AiError("AI_TIMEOUT", "AI request timed out");
        }
        throw new AiError(
          "AI_UNAVAILABLE",
          `AI provider unreachable: ${err instanceof Error ? err.message : "network error"}`,
        );
      }

      if (res.status === 401 || res.status === 403) {
        throw new AiError("AI_INVALID_KEY", "AI provider rejected the API key");
      }
      if (res.status === 429) {
        throw new AiError("AI_RATE_LIMITED", "AI provider rate limit exceeded");
      }
      if (!res.ok) {
        throw new AiError(
          "AI_BAD_RESPONSE",
          `AI provider returned status ${res.status}`,
        );
      }

      const data = (await res.json().catch(() => null)) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      } | null;
      const content = data?.choices?.[0]?.message?.content?.trim() ?? "";
      if (!content) {
        throw new AiError("AI_EMPTY_RESPONSE", "AI provider returned no content");
      }
      return content;
    } finally {
      clearTimeout(timeout);
      logger.debug(
        { baseUrl: this.config.baseUrl, model: this.config.model },
        "AI completion finished",
      );
    }
  }

  static async listModels(_config: { baseUrl: string; apiKey: string | null }): Promise<string[]> {
    try {
      const res = await fetch(`${_config.baseUrl.replace(/\/$/, "")}/models`, {
        method: "GET",
        headers: {
          ...(_config.apiKey ? { Authorization: `Bearer ${_config.apiKey}` } : {}),
        },
      });
      if (!res.ok) {
        return [];
      }
      const data = (await res.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
      return data?.data?.map((m) => m.id) ?? [];
    } catch {
      return [];
    }
  }

  async validateCredentials(config: { baseUrl: string; apiKey: string | null }): Promise<{ valid: boolean; error?: string }> {
    try {
      const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/models`, {
        method: "GET",
        headers: {
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
      });
      if (res.ok) {
        return { valid: true };
      }
      if (res.status === 401 || res.status === 403) {
        return { valid: false, error: "Invalid API key" };
      }
      return { valid: false, error: `Provider returned status ${res.status}` };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Connection failed" };
    }
  }
}

export class AnthropicAdapter implements ProviderAdapter {
  private config: { baseUrl: string; apiKey: string | null; model: string };

  constructor(config: { baseUrl: string; apiKey: string | null; model: string }) {
    this.config = config;
  }

  async completeChat(options: {
    system: string;
    user: string;
    maxTokens?: number;
    timeoutMs?: number;
  }): Promise<string> {
    const logger = getLogger();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 60_000,
    );
    try {
      let res: Response;
      try {
        const messages: Array<{ role: string; content: string }> = [];
        if (options.system) {
          messages.push({ role: "system", content: options.system });
        }
        messages.push({ role: "user", content: options.user });

        res = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/messages`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.apiKey ?? "",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: this.config.model,
            max_tokens: options.maxTokens ?? 2000,
            temperature: 0,
            messages,
            system: options.system,
          }),
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new AiError("AI_TIMEOUT", "AI request timed out");
        }
        throw new AiError(
          "AI_UNAVAILABLE",
          `AI provider unreachable: ${err instanceof Error ? err.message : "network error"}`,
        );
      }

      if (res.status === 401 || res.status === 403) {
        throw new AiError("AI_INVALID_KEY", "AI provider rejected the API key");
      }
      if (res.status === 429) {
        throw new AiError("AI_RATE_LIMITED", "AI provider rate limit exceeded");
      }
      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new AiError(
          "AI_BAD_RESPONSE",
          `AI provider returned status ${res.status}: ${errorText}`,
        );
      }

      const data = (await res.json().catch(() => null)) as {
        content?: Array<{ type: string; text: string }>;
      } | null;
      const content = data?.content?.[0]?.text?.trim() ?? "";
      if (!content) {
        throw new AiError("AI_EMPTY_RESPONSE", "AI provider returned no content");
      }
      return content;
    } finally {
      clearTimeout(timeout);
      logger.debug(
        { baseUrl: this.config.baseUrl, model: this.config.model },
        "AI completion finished",
      );
    }
  }

  static async listModels(_config: { baseUrl: string; apiKey: string | null }): Promise<string[]> {
    // Anthropic does not provide a models listing endpoint.
    return [];
  }

  async validateCredentials(config: { baseUrl: string; apiKey: string | null }): Promise<{ valid: boolean; error?: string }> {
    // Validate by making a minimal completion request.
    try {
      const testAdapter = new AnthropicAdapter({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: "claude-3-5-sonnet-latest" });
      await testAdapter.completeChat({
        system: "You are a test assistant.",
        user: "Reply with 'OK'",
        maxTokens: 10,
        timeoutMs: 15000,
      });
      return { valid: true };
    } catch (err) {
      if (err instanceof AiError) {
        return { valid: false, error: err.message };
      }
      return { valid: false, error: err instanceof Error ? err.message : "Connection failed" };
    }
  }
}

export function createAdapter(config: AiConfig): ProviderAdapter {
  const metadata = KNOWN_PROVIDERS[config.provider];
  if (!metadata) {
    throw new Error(`Unknown provider: ${config.provider}`);
  }
  if (config.provider === "anthropic") {
    return new AnthropicAdapter({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
    });
  }
  // All other providers use OpenAI-compatible adapter
  return new OpenAICompatibleAdapter({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  });
}

export function getProviderAdapter(providerId: string): ProviderAdapter {
  const metadata = KNOWN_PROVIDERS[providerId];
  if (!metadata) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  // Return appropriate adapter based on provider
  if (providerId === "anthropic") {
    return new AnthropicAdapter({ baseUrl: "", apiKey: null, model: "" });
  }
  // All other providers use OpenAI-compatible adapter
  return new OpenAICompatibleAdapter({
    baseUrl: "",
    apiKey: null,
    model: "",
  });
}

export function getProviderMetadata(providerId: string): ProviderMetadata | null {
  return KNOWN_PROVIDERS[providerId] ?? null;
}

export function listKnownProviders(): ProviderMetadata[] {
  return Object.values(KNOWN_PROVIDERS);
}

/**
 * Resolve the AI configuration for a request.
 * Priority:
 * 1. User's active AI provider configuration (if authenticated)
 * 2. System environment configuration (AI_API_KEY, AI_BASE_URL, etc.)
 */
export async function resolveAiConfig(userId?: string): Promise<AiConfig | null> {
  // 1. Try user's active provider configuration
  if (userId) {
    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(userAiProviders)
        .where(and(eq(userAiProviders.userId, userId), eq(userAiProviders.isActive, true)))
        .limit(1);

      const userProvider = rows[0];
      if (userProvider) {
        let apiKey: string | null = null;
        if (userProvider.apiKeyEncrypted) {
          try {
            apiKey = decryptSecret({
              ciphertext: userProvider.apiKeyEncrypted,
              iv: userProvider.apiKeyIv!,
              tag: userProvider.apiKeyTag!,
            });
          } catch {
            // Decryption failed - treat as unconfigured
          }
        }

        return {
          provider: userProvider.provider,
          model: userProvider.model,
          baseUrl: userProvider.baseUrl ?? KNOWN_PROVIDERS[userProvider.provider]?.defaultBaseUrl ?? "https://api.openai.com/v1",
          apiKey,
        };
      }
    } catch (err) {
      // Database error (e.g., table doesn't exist, connection error) - fall back to system config
      const logger = getLogger();
      logger.warn({ err, userId }, "Failed to resolve user AI config, falling back to system config");
    }
  }

  // 2. Fall back to system environment configuration
  return getAiConfig();
}

/**
 * Encrypt and store a user's AI provider configuration.
 */
export async function saveUserAiProvider(
  userId: string,
  provider: string,
  model: string,
  baseUrl: string | null,
  apiKey: string | null,
): Promise<void> {
  let encrypted: EncryptedSecret | null = null;
  if (apiKey) {
    encrypted = encryptSecret(apiKey);
  }

  const db = getDb();
  await db
    .insert(userAiProviders)
    .values({
      userId,
      provider,
      model,
      baseUrl,
      apiKeyEncrypted: encrypted?.ciphertext ?? null,
      apiKeyIv: encrypted?.iv ?? null,
      apiKeyTag: encrypted?.tag ?? null,
      isActive: false,
    })
    .onConflictDoUpdate({
      target: [userAiProviders.userId, userAiProviders.provider],
      set: {
        model,
        baseUrl,
        apiKeyEncrypted: encrypted?.ciphertext ?? null,
        apiKeyIv: encrypted?.iv ?? null,
        apiKeyTag: encrypted?.tag ?? null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Set a provider as the active one for a user.
 */
export async function setActiveAiProvider(userId: string, provider: string): Promise<void> {
  const db = getDb();
  await db
    .update(userAiProviders)
    .set({ isActive: false })
    .where(eq(userAiProviders.userId, userId));

  await db
    .update(userAiProviders)
    .set({ isActive: true, updatedAt: new Date() })
    .where(and(eq(userAiProviders.userId, userId), eq(userAiProviders.provider, provider)));
}

/**
 * Get all AI provider configurations for a user (without secrets).
 */
export async function getUserAiProviders(userId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: userAiProviders.id,
      provider: userAiProviders.provider,
      model: userAiProviders.model,
      baseUrl: userAiProviders.baseUrl,
      isActive: userAiProviders.isActive,
      createdAt: userAiProviders.createdAt,
      updatedAt: userAiProviders.updatedAt,
    })
    .from(userAiProviders)
    .where(eq(userAiProviders.userId, userId))
    .orderBy(userAiProviders.createdAt);

  return rows;
}

/**
 * Delete a user's AI provider configuration.
 */
export async function deleteUserAiProvider(userId: string, provider: string): Promise<void> {
  const db = getDb();
  await db
    .delete(userAiProviders)
    .where(and(eq(userAiProviders.userId, userId), eq(userAiProviders.provider, provider)));
}

/**
 * Test an AI provider configuration.
 */
export async function testAiProvider(config: { provider: string; model: string; baseUrl: string; apiKey: string | null }) {
  const started = Date.now();
  let adapter: ProviderAdapter;
  try {
    adapter = createAdapter({
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });
  } catch (err) {
    return { success: false, error: "Unknown provider", latencyMs: Date.now() - started };
  }

  const validation = await adapter.validateCredentials({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  });

  if (!validation.valid) {
    return { success: false, error: validation.error, latencyMs: Date.now() - started };
  }

  // Try a minimal completion
  try {
    await adapter.completeChat({
      system: "You are a test assistant.",
      user: "Reply with 'OK'",
      maxTokens: 10,
      timeoutMs: 15000,
    });
    return { success: true, model: config.model, latencyMs: Date.now() - started };
  } catch (err) {
    let errorCategory = "Test failed";
    if (err instanceof AiError) {
      // Map AiError codes to safe categories
      switch (err.code) {
        case "AI_TIMEOUT":
          errorCategory = "Timeout";
          break;
        case "AI_INVALID_KEY":
          errorCategory = "Invalid credentials";
          break;
        case "AI_RATE_LIMITED":
          errorCategory = "Rate limited";
          break;
        case "AI_BAD_RESPONSE":
          errorCategory = "Provider error";
          break;
        case "AI_EMPTY_RESPONSE":
          errorCategory = "Empty response";
          break;
        default:
          errorCategory = "Provider error";
      }
    }
    return { success: false, error: errorCategory, latencyMs: Date.now() - started };
  }
}