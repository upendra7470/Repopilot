import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers.js";

describe("Repository routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /api/repositories creates a repository", async () => {
    const uniqueSuffix = Date.now();
    const response = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        owner: "test-org",
        name: "test-repo-" + uniqueSuffix,
        fullName: "test-org/test-repo-" + uniqueSuffix,
        description: "A test repository",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.owner).toBe("test-org");
    expect(body.name).toBe("test-repo-" + uniqueSuffix);
    expect(body.fullName).toBe("test-org/test-repo-" + uniqueSuffix);
    expect(body.id).toBeDefined();
  });

  it("GET /api/repositories lists repositories", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/repositories",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/repositories/:id returns 404 for non-existent repository", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/repositories/00000000-0000-0000-0000-000000000000",
    });

    expect(response.statusCode).toBe(404);
  });

  it("POST /api/repositories with invalid body returns 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        name: "missing-fields",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("GET /api/users/:userId/repositories returns user repositories", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/users/00000000-0000-0000-0000-000000000000/repositories",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(Array.isArray(body)).toBe(true);
  });
});
