import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../routes/__tests__/helpers.js";

/**
 * Guards the server lifecycle itself: the built app must bind a real port,
 * stay alive, and serve routes over actual HTTP (inject() alone cannot
 * catch listen/bind/startup failures).
 */
describe("Server startup lifecycle", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    expect(port).toBeGreaterThan(0);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("stays alive and serves /health over real HTTP", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("serves the OAuth start route over real HTTP when unconfigured", async () => {
    const res = await fetch(`${baseUrl}/api/auth/github`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login?error=oauth_not_configured");
  });

  it("rejects anonymous access to protected routes over real HTTP", async () => {
    const res = await fetch(`${baseUrl}/api/users`);
    expect(res.status).toBe(401);
  });

  it("remains reachable across consecutive requests (no flapping)", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
    }
  });
});
