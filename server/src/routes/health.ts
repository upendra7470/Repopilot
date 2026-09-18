import type { FastifyInstance } from "fastify";
import { getEnv } from "../config/env.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", {
    schema: {
      response: {
        200: {
          type: "object",
          required: ["status", "timestamp", "uptime"],
          properties: {
            status: { type: "string" },
            timestamp: { type: "string" },
            uptime: { type: "number" },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      return reply.send({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    },
  });

  app.get("/health/db", {
    schema: {
      response: {
        200: {
          type: "object",
          required: ["status", "database"],
          properties: {
            status: { type: "string" },
            database: { type: "string" },
          },
        },
        503: {
          type: "object",
          required: ["status", "database"],
          properties: {
            status: { type: "string" },
            database: { type: "string" },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      const env = getEnv();
      try {
        const { Client } = await import("pg");
        const client = new Client({ connectionString: env.DATABASE_URL });
        await client.connect();
        await client.query("SELECT 1");
        await client.end();
        return reply.send({ status: "ok", database: "ok" });
      } catch {
        return reply.status(503).send({ status: "error", database: "error" });
      }
    },
  });
}
