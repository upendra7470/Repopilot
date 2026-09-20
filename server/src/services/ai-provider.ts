import { getEnv } from "../config/env.js";
import { getLogger } from "../utils/logger.js";

/**
 * AI Provider abstraction (Phase 17).
 *
 * Supports both system-configured and user-configured AI providers.
 * Works with OpenAI, Ollama, LM Studio, or any OpenAI-compatible endpoint.
 * AI is strictly optional: when unconfigured, callers serve deterministic
 * intelligence with an explicit AI_UNAVAILABLE state. Never fabricated.
 */

export interface AiConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string | null;
}

export type AiErrorCode =
  | "AI_UNAVAILABLE"
  | "AI_TIMEOUT"
  | "AI_RATE_LIMITED"
  | "AI_INVALID_KEY"
  | "AI_BAD_RESPONSE"
  | "AI_EMPTY_RESPONSE";

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

export interface ChatOptions {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}

/** Resolved config from system environment, or null when AI is not configured. */
export function getAiConfig(): AiConfig | null {
  const env = getEnv();
  if (env.AI_API_KEY) {
    return {
      provider: env.AI_PROVIDER ?? "openai",
      model: env.AI_MODEL ?? "gpt-4o-mini",
      baseUrl: env.AI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: env.AI_API_KEY,
    };
  }
  // Keyless local endpoints (Ollama / LM Studio) are valid without a key.
  if (env.AI_BASE_URL) {
    return {
      provider: env.AI_PROVIDER ?? "local",
      model: env.AI_MODEL ?? "default",
      baseUrl: env.AI_BASE_URL,
      apiKey: null,
    };
  }
  return null;
}

/**
 * Single chat completion, returned as raw text. Timeouts, HTTP failures,
 * and transport errors map to classified AiErrors. The API key is sent in
 * the Authorization header only — never logged.
 *
 * If config is provided, it takes precedence over system configuration.
 * This allows user-configured AI providers to take precedence.
 */
export async function completeChat(
  options: ChatOptions,
  config?: AiConfig | null,
): Promise<string> {
  const logger = getLogger();
  const effectiveConfig = config ?? getAiConfig();
  if (!effectiveConfig) {
    throw new AiError("AI_UNAVAILABLE", "AI provider is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60_000,
  );
  try {
    let res: Response;
    try {
      res = await fetch(`${effectiveConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(effectiveConfig.apiKey ? { Authorization: `Bearer ${effectiveConfig.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: effectiveConfig.model,
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
      { provider: effectiveConfig.provider, model: effectiveConfig.model },
      "AI completion finished",
    );
  }
}

/**
 * Extract a JSON object from model text (tolerates markdown fences).
 * Throws AiError BAD_RESPONSE when no object can be recovered.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AiError("AI_BAD_RESPONSE", "AI response contained no JSON object");
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AiError("AI_BAD_RESPONSE", "AI response was not valid JSON");
  }
}