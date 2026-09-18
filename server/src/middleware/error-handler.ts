import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export async function errorHandler(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode ?? 500;
    const code = (error as AppError).code ?? "INTERNAL_ERROR";
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    const details = (error as AppError).details;

    app.log.error({ err: error, statusCode, code }, "Request error");

    return reply.status(statusCode).send({
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    });
  });
}
