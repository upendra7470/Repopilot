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

/**
 * Honest provider capability model (Phase 22).
 * A capability is listed only when the adapter behavior actually supports
 * it — never inferred per-model. Per-model capabilities (tools, vision,
 * reasoning) are NOT claimed here because `/models` endpoints do not
 * reliably report them.
 */
export interface ProviderCapabilities {
  /** Live `/models` discovery via the adapter. */
  modelDiscovery: boolean;
  /** Credential validation without a full completion (see notes per adapter). */
  connectionTest: boolean;
  /** JSON structured-output reasoning via the shared system-prompt contract. */
  structuredOutput: boolean;
  /** Token streaming. No adapter implements streaming today. */
  streaming: boolean;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  description: string;
  supportsModelListing: boolean;
  protocol: "openai-compatible" | "native-anthropic";
  capabilities: ProviderCapabilities;
  defaultBaseUrl?: string;
  defaultModel?: string;
}

const OPENAI_COMPATIBLE: ProviderCapabilities = {
  modelDiscovery: true,
  connectionTest: true,
  structuredOutput: true,
  streaming: false,
};

const NO_DISCOVERY: ProviderCapabilities = {
  modelDiscovery: false,
  connectionTest: true,
  structuredOutput: true,
  streaming: false,
};

export const KNOWN_PROVIDERS: Record<string, ProviderMetadata> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI API (GPT-4, GPT-3.5, etc.)",
    supportsModelListing: true,
    protocol: "openai-compatible",
    capabilities: OPENAI_COMPATIBLE,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    description: "Anthropic API (Claude models) - native protocol",
    supportsModelListing: false,
    protocol: "native-anthropic",
    // No list-models endpoint exists; validation falls back to a minimal
    // probe completion, so connectionTest stays honest but costly.
    capabilities: NO_DISCOVERY,
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-sonnet-latest",
  },
  mistral: {
    id: "mistral",
    name: "Mistral",
    description: "Mistral AI API - OpenAI-compatible",
    supportsModelListing: true,
    protocol: "openai-compatible",
    capabilities: OPENAI_COMPATIBLE,
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
  },
  groq: {
    id: "groq",
    name: "Groq",
    description: "Groq API - OpenAI-compatible",
    supportsModelListing: true,
    protocol: "openai-compatible",
    capabilities: OPENAI_COMPATIBLE,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.1-70b-versatile",
  },
  together: {
    id: "together",
    name: "Together AI",
    description: "Together AI - OpenAI-compatible",
    supportsModelListing: true,
    protocol: "openai-compatible",
    capabilities: OPENAI_COMPATIBLE,
    defaultBaseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
  },
  fireworks: {
    id: "fireworks",
    name: "Fireworks AI",
    description: "Fireworks AI - OpenAI-compatible",
    supportsModelListing: true,
    protocol: "openai-compatible",
    capabilities: OPENAI_COMPATIBLE,
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct",
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    description: "Cerebras Inference - OpenAI-compatible",
    supportsModelListing: true,
    protocol: "openai-compatible",
    capabilities: OPENAI_COMPATIBLE,
    defaultBaseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama3.1-70b",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    description: "OpenRouter - OpenAI-compatible gateway",
    supportsModelListing: true,
    protocol: "openai-compatible",
    capabilities: OPENAI_COMPATIBLE,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/auto",
  },
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    description: "Local Ollama server - OpenAI-compatible",
    supportsModelListing: true,
    protocol: "openai-compatible",
    capabilities: OPENAI_COMPATIBLE,
    defaultBaseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.1",
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio (Local)",
    description: "Local LM Studio server - OpenAI-compatible",
    supportsModelListing: true,
    protocol: "openai-compatible",
    capabilities: OPENAI_COMPATIBLE,
    defaultBaseUrl: "http://localhost:1234/v1",
    defaultModel: "default",
  },
  custom: {
    id: "custom",
    name: "Custom OpenAI-Compatible",
    description: "Any OpenAI-compatible endpoint",
    supportsModelListing: false,
    protocol: "openai-compatible",
    // Discovery is attempted opportunistically (many self-hosted endpoints
    // expose /models) but not advertised, so the UI leads with manual entry.
    capabilities: NO_DISCOVERY,
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
 * A null apiKey means "keep any existing stored key" (used by edit flows
 * that only change the model); a string (even empty) replaces it.
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
  const keyColumns =
    apiKey === null
      ? {}
      : {
          apiKeyEncrypted: encrypted?.ciphertext ?? null,
          apiKeyIv: encrypted?.iv ?? null,
          apiKeyTag: encrypted?.tag ?? null,
        };
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
        ...keyColumns,
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
 * Normalized model catalog entry (Phase 22).
 * Only fields actually present in the provider response are populated —
 * absent fields are omitted, never fabricated. Per-model capabilities
 * (tools/vision/reasoning) are intentionally NOT inferred: `/models`
 * endpoints do not reliably report them.
 */
export interface DiscoveredModel {
  id: string;
  displayName?: string;
  provider: string;
  contextWindow?: number;
}

export interface DiscoverModelsResult {
  models: DiscoveredModel[];
  /** Human-readable failure reason when models is empty (null on success). */
  error: string | null;
  /** True when served from the short-lived server-side cache. */
  cached: boolean;
}

const MAX_DISCOVERED_MODELS = 200;
const MAX_MODEL_ID_CHARS = 200;
const DISCOVER_TIMEOUT_MS = 15_000;

interface RawModelEntry {
  id?: unknown;
  name?: unknown;
  context_window?: unknown;
  context_length?: unknown;
  max_context_length?: unknown;
}

function sanitizeModelId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > MAX_MODEL_ID_CHARS) return null;
  // Model IDs are path-safe tokens; reject control characters.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

function sanitizeContextWindow(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(Math.floor(value), 10_000_000);
}

/**
 * Outbound base-URL guard (SSRF hardening).
 *
 * Provider base URLs are user-supplied and fetched server-side, so they are
 * validated before any request: http(s) scheme only, plus a block on
 * link-local/unspecified targets — most importantly the cloud metadata
 * address 169.254.169.254, reachable from the server but never a legitimate
 * model endpoint. DNS is resolved and every answer checked, so a hostile
 * hostname cannot smuggle a blocked address past a literal-IP check.
 *
 * Deliberate tradeoff, documented: loopback and private-LAN addresses are
 * ALLOWED because local-first providers (Ollama, LM Studio) and self-hosted
 * gateways require them. The residual risk (an authenticated user probing
 * their own LAN through the server) is accepted for a self-hosted BYOK tool;
 * the metadata-service hole — the credential-bearing target — is closed.
 */
function isBlockedIp(addr: string): boolean {
  const v = addr.toLowerCase();
  if (v === "0.0.0.0" || v === "::") return true;
  if (v.startsWith("169.254.")) return true;
  if (v.startsWith("fe80:") || v.startsWith("[fe80:")) return true;
  return false;
}

async function resolveHostIps(hostname: string): Promise<string[] | null> {
  const clean = hostname.replace(/^\[|\]$/g, "");
  const { isIP } = await import("node:net");
  if (isIP(clean)) return [clean];
  try {
    const { lookup } = await import("node:dns/promises");
    const settled = await Promise.race([
      lookup(clean, { all: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("dns timeout")), 5000),
      ),
    ]);
    return settled.map((r) => r.address);
  } catch {
    return null;
  }
}

/**
 * Returns null when the base URL is safe to fetch, or a human-readable
 * reason when it must be refused. Never throws.
 */
export async function validateOutboundBaseUrl(baseUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return "Invalid base URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Base URL must use http or https";
  }
  if (url.username || url.password) {
    return "Base URL must not embed credentials";
  }
  const ips = await resolveHostIps(url.hostname);
  if (!ips) {
    return "Base URL host could not be resolved";
  }
  if (ips.some(isBlockedIp)) {
    return "Base URL resolves to a blocked address";
  }
  return null;
}

/**
 * Short-lived server-side model catalog cache (Phase 22, Step 14).
 * Keyed by user + provider + base URL so one user's catalog can never
 * leak into another user's session. Stores normalized models only —
 * never credentials. TTL is intentionally short (5 minutes).
 */
const DISCOVERY_CACHE_TTL_MS = 5 * 60_000;
const discoveryCache = new Map<string, { at: number; result: DiscoverModelsResult }>();

function discoveryCacheKey(userId: string, provider: string, baseUrl: string): string {
  return `${userId}:${provider}:${baseUrl.replace(/\/$/, "")}`;
}

/** Test-only hook to reset the discovery cache between tests. */
export function clearDiscoveryCache(): void {
  discoveryCache.clear();
}

/**
 * Discover available models for a provider by querying its OpenAI-compatible
 * `/models` endpoint. Never throws: transport, auth, and rate-limit
 * failures are reported via the `error` field so callers can render
 * graceful UI states. Anthropic exposes no list-models endpoint and
 * yields an empty result with an explanatory error.
 *
 * Pass `userId` to enable the short-lived per-user cache; pass
 * `refresh: true` to bypass it. The cache never stores credentials.
 */
export async function discoverModels(config: {
  provider: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  userId?: string;
  refresh?: boolean;
}): Promise<DiscoverModelsResult> {
  const logger = getLogger();
  const metadata = KNOWN_PROVIDERS[config.provider];
  if (!metadata) {
    return { models: [], error: "Unknown provider", cached: false };
  }

  const baseUrl = (config.baseUrl ?? "").trim() || metadata.defaultBaseUrl || "";
  if (!baseUrl) {
    return { models: [], error: "A base URL is required for this provider", cached: false };
  }
  const baseUrlError = await validateOutboundBaseUrl(baseUrl);
  if (baseUrlError) {
    return { models: [], error: baseUrlError, cached: false };
  }

  if (config.provider === "anthropic") {
    return { models: [], error: "Anthropic exposes no model-listing endpoint; enter the model ID manually", cached: false };
  }

  const cacheKey = config.userId ? discoveryCacheKey(config.userId, config.provider, baseUrl) : null;
  if (cacheKey && !config.refresh) {
    const hit = discoveryCache.get(cacheKey);
    if (hit && Date.now() - hit.at < DISCOVERY_CACHE_TTL_MS) {
      return { ...hit.result, cached: true };
    }
    if (hit) discoveryCache.delete(cacheKey);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVER_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
        method: "GET",
        signal: controller.signal,
        headers: {
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { models: [], error: "Request timed out", cached: false };
      }
      logger.warn({ provider: config.provider }, "Model discovery unreachable");
      return { models: [], error: "Provider unreachable", cached: false };
    }

    if (res.status === 401 || res.status === 403) {
      return { models: [], error: "Invalid API key", cached: false };
    }
    if (res.status === 429) {
      return { models: [], error: "Rate limited — try again shortly", cached: false };
    }
    if (!res.ok) {
      return { models: [], error: `Provider returned status ${res.status}`, cached: false };
    }

    const data = (await res.json().catch(() => null)) as {
      data?: RawModelEntry[];
    } | null;
    const entries = Array.isArray(data?.data) ? data.data : [];
    const seen = new Set<string>();
    const models: DiscoveredModel[] = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const id = sanitizeModelId(entry.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const model: DiscoveredModel = { id, provider: config.provider };
      if (typeof entry.name === "string" && entry.name.trim()) {
        model.displayName = entry.name.trim().slice(0, MAX_MODEL_ID_CHARS);
      }
      const contextWindow = sanitizeContextWindow(
        entry.context_window ?? entry.context_length ?? entry.max_context_length,
      );
      if (contextWindow !== undefined) {
        model.contextWindow = contextWindow;
      }
      models.push(model);
      if (models.length >= MAX_DISCOVERED_MODELS) break;
    }
    models.sort((a, b) => a.id.localeCompare(b.id));
    const result: DiscoverModelsResult = { models, error: null, cached: false };
    if (cacheKey) {
      discoveryCache.set(cacheKey, { at: Date.now(), result });
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Test Connection (Phase 22, Step 10): can RepoPilot authenticate with the
 * provider? Validates credentials only — no model completion is attempted,
 * so this never spends model tokens. (Anthropic is the honest exception:
 * its native API exposes no credential-check endpoint, so validation uses
 * a minimal 10-token probe completion.)
 */
export async function testConnection(config: {
  provider: string;
  baseUrl?: string | null;
  apiKey?: string | null;
}): Promise<{ success: boolean; error?: string; latencyMs: number }> {
  const started = Date.now();
  const metadata = KNOWN_PROVIDERS[config.provider];
  if (!metadata) {
    return { success: false, error: "Unknown provider", latencyMs: Date.now() - started };
  }
  const baseUrl = (config.baseUrl ?? "").trim() || metadata.defaultBaseUrl || "";
  if (!baseUrl) {
    return { success: false, error: "A base URL is required for this provider", latencyMs: Date.now() - started };
  }
  const baseUrlError = await validateOutboundBaseUrl(baseUrl);
  if (baseUrlError) {
    return { success: false, error: baseUrlError, latencyMs: Date.now() - started };
  }
  let adapter: ProviderAdapter;
  try {
    adapter = createAdapter({ provider: config.provider, model: "", baseUrl, apiKey: config.apiKey ?? null });
  } catch {
    return { success: false, error: "Unknown provider", latencyMs: Date.now() - started };
  }
  const validation = await adapter.validateCredentials({ baseUrl, apiKey: config.apiKey ?? null });
  if (!validation.valid) {
    return { success: false, error: validation.error ?? "Connection failed", latencyMs: Date.now() - started };
  }
  return { success: true, latencyMs: Date.now() - started };
}

/**
 * Discover models using a user's SAVED configuration (Phase 22, Step 4).
 * Credentials are decrypted server-side only and never leave the server.
 * Returns null when the user has no such provider configured.
 */
export async function discoverModelsWithSavedCredentials(
  userId: string,
  provider: string,
  opts?: { refresh?: boolean },
): Promise<DiscoverModelsResult | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(userAiProviders)
    .where(and(eq(userAiProviders.userId, userId), eq(userAiProviders.provider, provider)))
    .limit(1);
  const record = rows[0];
  if (!record) return null;

  let apiKey: string | null = null;
  if (record.apiKeyEncrypted) {
    try {
      apiKey = decryptSecret({
        ciphertext: record.apiKeyEncrypted,
        iv: record.apiKeyIv!,
        tag: record.apiKeyTag!,
      });
    } catch {
      return { models: [], error: "Stored credentials could not be decrypted; re-enter the API key", cached: false };
    }
  }
  return discoverModels({
    provider,
    baseUrl: record.baseUrl,
    apiKey,
    userId,
    refresh: opts?.refresh,
  });
}

/**
 * Test an AI provider configuration.
 */
export async function testAiProvider(config: { provider: string; model: string; baseUrl: string; apiKey: string | null }) {
  const started = Date.now();
  const baseUrlError = await validateOutboundBaseUrl(config.baseUrl);
  if (baseUrlError) {
    return { success: false, error: baseUrlError, latencyMs: Date.now() - started };
  }
  let adapter: ProviderAdapter;
  try {
    adapter = createAdapter({
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });
  } catch {
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