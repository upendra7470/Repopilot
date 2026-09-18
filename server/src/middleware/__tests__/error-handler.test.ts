import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { errorHandler } from "../error-handler.js";

async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify();
  await app.register(sensible);
  // Same as server/src/app.ts: applied to the root instance directly so the
  // handler governs every route (register() would encapsulate it away).
  await errorHandler(app);
  app.get("/boom", async () => {
    throw new Error("something with internals");
  });
  app.get("/missing", async (_request, reply) => {
    return reply.notFound("No such thing");
  });
  return app;
}

describe("Error handler", () => {
  it("sanitizes 500s but attaches a correlation requestId", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/boom" });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.payload);
    expect(body.error).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
    expect(body.error.message).not.toContain("internals");
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(0);
    await app.close();
  });

  it("preserves safe 4xx messages with requestId", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/missing" });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.payload);
    expect(body.error.message).toBe("No such thing");
    expect(typeof body.requestId).toBe("string");
    await app.close();
  });
});
