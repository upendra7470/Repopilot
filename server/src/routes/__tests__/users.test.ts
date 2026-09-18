import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";

describe("User routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/users requires authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/users",
    });

    expect(response.statusCode).toBe(401);
  });

  it("GET /api/users lists users for authenticated requests", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((u: { id: string }) => u.id === login.user.id)).toBe(true);
  });

  it("GET /api/users/:id returns the safe profile", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "GET",
      url: `/api/users/${login.user.id}`,
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.id).toBe(login.user.id);
    expect(body.login).toBe(login.user.login);
    // Safe serialization only: no credential material.
    expect(response.payload).not.toContain("accessToken");
    expect(response.payload).not.toContain("tokenHash");
  });

  it("GET /api/users/:id returns 404 for an unknown user", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "GET",
      url: "/api/users/00000000-0000-0000-0000-000000000000",
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it("GET /api/users/:id returns 400 for a malformed id", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "GET",
      url: "/api/users/not-a-uuid",
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(400);
  });

  it("POST /api/users is closed: provisioning happens via GitHub login only", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: login.cookie },
      payload: { login: "should-not-be-created" },
    });

    expect(response.statusCode).toBe(404);
  });
});
