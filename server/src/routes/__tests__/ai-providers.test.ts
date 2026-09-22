import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";
import { saveUserAiProvider } from "../../services/ai-registry.js";

function modelsResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
  };
}

describe("POST /api/ai-providers/discover-models", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects anonymous requests with 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      payload: { provider: "openai", apiKey: "sk-test" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects unknown providers with 400", async () => {
    const login = await loginTestUser();
    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload: { provider: "nope", apiKey: "sk-test" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns sanitized models on upstream success", async () => {
    const login = await loginTestUser();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        modelsResponse({
          data: [
            { id: "gpt-4o-mini", context_window: 128000 },
            { id: "  gpt-4o  ", name: "GPT-4o" },
            { id: "", context_window: 1 },
            { id: 42 },
          ],
        }),
      ),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload: { provider: "openai", apiKey: "sk-test", baseUrl: "https://api.openai.com/v1" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.error).toBeNull();
    expect(body.cached).toBe(false);
    expect(body.models).toEqual([
      { id: "gpt-4o", displayName: "GPT-4o", provider: "openai" },
      { id: "gpt-4o-mini", provider: "openai", contextWindow: 128000 },
    ]);
  });

  it("handles malformed and empty upstream responses without throwing", async () => {
    const login = await loginTestUser();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelsResponse({ unexpected: true })));

    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload: { provider: "openai", apiKey: "sk-test" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.models).toEqual([]);
    expect(body.error).toBeNull();
  });

  it("refuses link-local metadata addresses without fetching", async () => {
    const login = await loginTestUser();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload: { provider: "custom", apiKey: null, baseUrl: "http://169.254.169.254/v1" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.models).toEqual([]);
    expect(body.error).toContain("blocked address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses non-http schemes and embedded credentials", async () => {
    const login = await loginTestUser();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const baseUrl of ["ftp://example.com/v1", "https://user:pass@example.com/v1"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/ai-providers/discover-models",
        headers: { cookie: login.cookie },
        payload: { provider: "custom", apiKey: null, baseUrl },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload).models).toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses unresolvable hosts without fetching", async () => {
    const login = await loginTestUser();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload: { provider: "custom", apiKey: null, baseUrl: "https://nonexistent.invalid/v1" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.models).toEqual([]);
    expect(body.error).toContain("could not be resolved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects blocked base URLs at save time", async () => {
    const login = await loginTestUser();
    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers",
      headers: { cookie: login.cookie },
      payload: {
        provider: "custom",
        model: "x",
        baseUrl: "http://169.254.169.254/v1",
        apiKey: null,
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("reports invalid API keys gracefully without throwing", async () => {
    const login = await loginTestUser();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelsResponse({ error: "bad key" }, 401)));

    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload: { provider: "openai", apiKey: "sk-wrong", baseUrl: "https://api.openai.com/v1" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.models).toEqual([]);
    expect(body.error).toBe("Invalid API key");
  });

  it("reports rate limits gracefully", async () => {
    const login = await loginTestUser();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(modelsResponse({}, 429)));

    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload: { provider: "groq", apiKey: "sk-test" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.models).toEqual([]);
    expect(body.error).toContain("Rate limited");
  });

  it("handles unreachable providers gracefully", async () => {
    const login = await loginTestUser();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload: { provider: "custom", apiKey: null, baseUrl: "http://localhost:9/v1" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.models).toEqual([]);
    expect(body.error).toBe("Provider unreachable");
  });

  it("serves the second identical discovery from the per-user cache", async () => {
    const login = await loginTestUser();
    const fetchMock = vi.fn().mockResolvedValue(
      modelsResponse({ data: [{ id: "llama3.1" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = { provider: "ollama", apiKey: null, baseUrl: "http://localhost:11434/v1" };
    const first = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.payload).cached).toBe(false);

    const second = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.payload).cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache when refresh is requested", async () => {
    const login = await loginTestUser();
    const fetchMock = vi.fn().mockResolvedValue(
      modelsResponse({ data: [{ id: "llama3.1" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const base = { provider: "ollama", apiKey: null, baseUrl: "http://localhost:11434/v1" };
    await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload: base,
    });
    const refreshed = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload: { ...base, refresh: true },
    });
    expect(JSON.parse(refreshed.payload).cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("isolates the discovery cache per user", async () => {
    const userA = await loginTestUser();
    const userB = await loginTestUser();
    const fetchMock = vi.fn().mockResolvedValue(
      modelsResponse({ data: [{ id: "llama3.1" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = { provider: "ollama", apiKey: null, baseUrl: "http://localhost:11434/v1" };
    await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: userA.cookie },
      payload,
    });
    const other = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: userB.cookie },
      payload,
    });
    expect(JSON.parse(other.payload).cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains anthropic has no listing endpoint without calling fetch", async () => {
    const login = await loginTestUser();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/discover-models",
      headers: { cookie: login.cookie },
      payload: { provider: "anthropic", apiKey: "sk-ant-test" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.models).toEqual([]);
    expect(body.error).toContain("no model-listing endpoint");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
describe("provider capabilities and connection testing", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes honest capability metadata for every known provider", async () => {
    const login = await loginTestUser();
    const response = await app.inject({
      method: "GET",
      url: "/api/ai-providers/known",
      headers: { cookie: login.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.length).toBeGreaterThan(0);
    for (const p of body) {
      expect(typeof p.protocol).toBe("string");
      expect(p.capabilities).toMatchObject({
        modelDiscovery: expect.any(Boolean),
        connectionTest: expect.any(Boolean),
        structuredOutput: expect.any(Boolean),
        streaming: expect.any(Boolean),
      });
      // Discovery flag and capability flag must agree.
      expect(p.capabilities.modelDiscovery).toBe(p.supportsModelListing);
      // No adapter implements streaming today.
      expect(p.capabilities.streaming).toBe(false);
    }
    const anthropic = body.find((p: { id: string }) => p.id === "anthropic");
    expect(anthropic.protocol).toBe("native-anthropic");
    expect(anthropic.capabilities.modelDiscovery).toBe(false);
  });

  it("validates credentials via test-connection without a completion call", async () => {
    const login = await loginTestUser();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [{ id: "gpt-4o-mini" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/test-connection",
      headers: { cookie: login.cookie },
      payload: { provider: "openai", apiKey: "sk-test", baseUrl: "https://api.openai.com/v1" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(typeof body.latencyMs).toBe("number");
    // Only the GET /models credential check — never POST /chat/completions.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => !u.includes("/chat/completions"))).toBe(true);
  });

  it("reports bad credentials via test-connection with a human-readable error", async () => {
    const login = await loginTestUser();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/test-connection",
      headers: { cookie: login.cookie },
      payload: { provider: "openai", apiKey: "sk-wrong" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  it("refreshes the catalog from saved credentials without exposing secrets", async () => {
    const login = await loginTestUser();
    await saveUserAiProvider(login.user.id, "openai", "gpt-4o-mini", "https://api.openai.com/v1", "sk-saved");

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      // Assert the key travels only in the Authorization header upstream.
      expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-saved" });
      expect(String(url)).not.toContain("sk-saved");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ id: "gpt-4o-mini" }] }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/openai/refresh-models",
      headers: { cookie: login.cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.error).toBeNull();
    expect(body.models).toEqual([{ id: "gpt-4o-mini", provider: "openai" }]);
    expect(JSON.stringify(body)).not.toContain("sk-saved");
  });

  it("returns 404 when refreshing a provider with no saved configuration", async () => {
    const login = await loginTestUser();
    const response = await app.inject({
      method: "POST",
      url: "/api/ai-providers/groq/refresh-models",
      headers: { cookie: login.cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  });

  it("never returns secrets from the provider list", async () => {
    const login = await loginTestUser();
    await saveUserAiProvider(login.user.id, "groq", "llama3.1-70b", null, "sk-secret");

    const response = await app.inject({
      method: "GET",
      url: "/api/ai-providers",
      headers: { cookie: login.cookie },
    });
    expect(response.statusCode).toBe(200);
    const payload = response.payload.toLowerCase();
    expect(payload).not.toContain("sk-secret");
    expect(payload).not.toContain("apikeyencrypted");
    expect(payload).not.toContain("authorization");
  });
});
