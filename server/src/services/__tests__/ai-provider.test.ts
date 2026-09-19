import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { resetEnv } from "../../config/env.js";
import { resetLogger } from "../../utils/logger.js";
import {
  AiError,
  completeChat,
  extractJsonObject,
  getAiConfig,
} from "../ai-provider.js";

function setupEnv(overrides: Record<string, string | undefined> = {}): void {
  resetEnv();
  resetLogger();
  process.env.DATABASE_URL = "postgresql://localhost:5432/repopilot_test";
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.AUTH_SECRET = "test-only-auth-secret-at-least-32-chars!!";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function chatResponse(content: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () =>
      Promise.resolve({ choices: [{ message: { content } }] }),
  };
}

describe("AI provider abstraction", () => {
  beforeEach(() => setupEnv());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setupEnv();
  });

  it("reports unconfigured when no provider settings exist", () => {
    expect(getAiConfig()).toBeNull();
  });

  it("resolves hosted config from API key with OpenAI defaults", () => {
    setupEnv({ AI_API_KEY: "sk-test" });
    expect(getAiConfig()).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("supports keyless local endpoints", () => {
    setupEnv({ AI_BASE_URL: "http://localhost:11434/v1", AI_MODEL: "llama3" });
    const config = getAiConfig();
    expect(config?.apiKey).toBeNull();
    expect(config?.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("sends an OpenAI-compatible request and returns content", async () => {
    setupEnv({ AI_API_KEY: "sk-test" });
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('{"a":1}'));
    vi.stubGlobal("fetch", fetchMock);

    const text = await completeChat({ system: "s", user: "u" });

    expect(text).toBe('{"a":1}');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-test" });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "gpt-4o-mini", temperature: 0 });
  });

  it("omits Authorization for keyless endpoints", async () => {
    setupEnv({ AI_BASE_URL: "http://localhost:11434/v1" });
    const fetchMock = vi.fn().mockResolvedValue(chatResponse("hi"));
    vi.stubGlobal("fetch", fetchMock);

    await completeChat({ system: "s", user: "u" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init?.headers).not.toMatchObject({ Authorization: expect.anything() });
  });

  it("classifies transport failures without leaking the key", async () => {
    setupEnv({ AI_API_KEY: "sk-secret-value" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    const err = await completeChat({ system: "s", user: "u" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe("AI_UNAVAILABLE");
    expect(String(err)).not.toContain("sk-secret-value");
  });

  it("classifies invalid keys, rate limits, and empty responses", async () => {
    setupEnv({ AI_API_KEY: "sk-test" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(chatResponse("", 401)));
    await expect(completeChat({ system: "s", user: "u" })).rejects.toMatchObject({
      code: "AI_INVALID_KEY",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(chatResponse("", 429)));
    await expect(completeChat({ system: "s", user: "u" })).rejects.toMatchObject({
      code: "AI_RATE_LIMITED",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(chatResponse("   ")));
    await expect(completeChat({ system: "s", user: "u" })).rejects.toMatchObject({
      code: "AI_EMPTY_RESPONSE",
    });
  });

  it("extracts JSON from fenced and raw model text", () => {
    expect(extractJsonObject('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('prefix {"a": 2} suffix')).toEqual({ a: 2 });
    expect(() => extractJsonObject("no json here")).toThrowError(
      /no JSON object/,
    );
    expect(() => extractJsonObject('prefix {"not valid"} suffix')).toThrowError(
      /not valid JSON/,
    );
  });
});
