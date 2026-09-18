import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers.js";

describe("GitHub OAuth start (configured)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ githubConfigured: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/auth/github redirects to GitHub with identity scopes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/github",
    });

    expect(response.statusCode).toBe(302);
    const location = decodeURIComponent(
      response.headers.location as string,
    );
    expect(location).toContain("github.com/login/oauth/authorize");
    // Identity scopes only — no repository access requested.
    const scopeMatch = location.match(/[?&]scope=([^&]*)/);
    expect(scopeMatch).not.toBeNull();
    const scopes = (scopeMatch?.[1] ?? "").split(/[ +]/);
    expect(scopes).toContain("read:user");
    expect(scopes).toContain("user:email");
    expect(scopes.some((s) => s.includes("repo"))).toBe(false);
    expect(location).not.toContain("workflow");
  });

  it("GET /api/auth/github/callback without a code redirects with an error", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/github/callback",
    });

    expect(response.statusCode).toBe(302);
    const location = response.headers.location as string;
    expect(location).toContain("/login?error=");
    expect(location).not.toContain("access_token");
    expect(location).not.toContain("client_secret");
  });
});
