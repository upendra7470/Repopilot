import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers.js";

describe("User routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /api/users creates a user", async () => {
    const uniqueLogin = "testuser-" + Date.now();
    const response = await app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        login: uniqueLogin,
        name: "Test User",
        email: "test@example.com",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.login).toBe(uniqueLogin);
    expect(body.name).toBe("Test User");
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBeDefined();
  });

  it("GET /api/users lists users", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/users",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/users/:id returns 404 for non-existent user", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/users/00000000-0000-0000-0000-000000000000",
    });

    expect(response.statusCode).toBe(404);
  });

  it("POST /api/users with invalid body returns 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        email: "not-an-email",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
