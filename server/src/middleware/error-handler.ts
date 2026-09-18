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
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode ?? 500;
    const code = (error as AppError).code ?? "INTERNAL_ERROR";
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    const details = (error as AppError).details;

    app.log.error({ err: error, statusCode, code }, "Request error");

    // requestId lets a user report "Request failed ... (request <id>)" and
    // lets the developer correlate it with server logs — without leaking
    // anything about the failure itself.
    return reply.status(statusCode).send({
      requestId: request.id,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    });
  });
}
