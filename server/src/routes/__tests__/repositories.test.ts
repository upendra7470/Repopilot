import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("Repository routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /api/repositories requires authentication", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: { owner: "o", name: "n", fullName: "o/n" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("POST /api/repositories creates a repository linked to the creator", async () => {
    const login = await loginTestUser();
    const suffix = uniqueSuffix();

    const response = await app.inject({
      method: "POST",
      url: "/api/repositories",
      headers: { cookie: login.cookie },
      payload: {
        owner: "test-org",
        name: `test-repo-${suffix}`,
        fullName: `test-org/test-repo-${suffix}`,
        description: "A test repository",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.owner).toBe("test-org");
    expect(body.name).toBe(`test-repo-${suffix}`);
    expect(body.id).toBeDefined();
  });

  it("GET /api/repositories requires authentication and returns an array", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/repositories",
    });
    expect(anonymous.statusCode).toBe(401);

    const login = await loginTestUser();
    const response = await app.inject({
      method: "GET",
      url: "/api/repositories",
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(response.payload))).toBe(true);
  });

  it("GET /api/repositories/:id returns 404 for an unknown repository", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "GET",
      url: "/api/repositories/00000000-0000-0000-0000-000000000000",
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it("POST /api/repositories with invalid body returns 400", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "POST",
      url: "/api/repositories",
      headers: { cookie: login.cookie },
      payload: {
        name: "missing-fields",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("GET /api/users/:userId/repositories returns the current user's repositories", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "GET",
      url: `/api/users/${login.user.id}/repositories`,
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(response.payload))).toBe(true);
  });
});
