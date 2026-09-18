import type { FastifyInstance } from "fastify";
import { getLogger } from "../utils/logger.js";

export async function requestLogger(app: FastifyInstance): Promise<void> {
  const logger = getLogger();

  app.addHook("onResponse", (request, reply, done) => {
    logger.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
    });
    done();
  });

  app.addHook("onRequest", (request, _reply, done) => {
    logger.debug({ method: request.method, url: request.url }, "incoming request");
    done();
  });
}
