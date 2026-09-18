import { resetEnv } from "../../config/env.js";
import { resetLogger } from "../../utils/logger.js";
import { buildApp } from "../../app.js";
import type { FastifyInstance } from "fastify";

export async function buildTestApp(): Promise<FastifyInstance> {
  resetEnv();
  resetLogger();

  process.env.DATABASE_URL = "postgresql://localhost:5432/repopilot_test";
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";

  const app = await buildApp();
  return app;
}
