import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers.js";

describe("Health routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns 200 with status ok", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe("ok");
  });

  it("GET /health includes timestamp and uptime", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    const body = JSON.parse(response.payload);
    expect(body.timestamp).toBeDefined();
    expect(typeof body.timestamp).toBe("string");
    expect(body.uptime).toBeDefined();
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("GET /health/db returns database status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/db",
    });

    expect([200, 503]).toContain(response.statusCode);
    const body = JSON.parse(response.payload);
    expect(body.status).toBeDefined();
    expect(body.database).toBeDefined();
    expect(["ok", "error"]).toContain(body.database);
  });
});
