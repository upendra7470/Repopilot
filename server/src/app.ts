import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { getEnv } from "./config/env.js";
import { getLogger } from "./utils/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { healthRoutes } from "./routes/health.js";
import { userRoutes } from "./routes/users.js";
import { repositoryRoutes } from "./routes/repositories.js";

export async function buildApp(): Promise<FastifyInstance> {
  const env = getEnv();
  const logger = getLogger();

  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : undefined,
    trustProxy: true,
  });

  if (env.NODE_ENV !== "test") {
    app.log = logger;
  }

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });

  await app.register(sensible);

  await app.register(errorHandler);
  await app.register(requestLogger);

  await app.register(healthRoutes);
  await app.register(userRoutes, { prefix: "/api" });
  await app.register(repositoryRoutes, { prefix: "/api" });

  return app;
}
