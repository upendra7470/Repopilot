import type { FastifyReply } from "fastify";
import { GithubApiError } from "../services/github-provider.js";

/**
 * Map GitHub provider failures to safe API errors. Never leaks tokens,
 * upstream bodies, or internal details — only a stable code and a
 * user-actionable message.
 */
export function sendGithubError(
  err: GithubApiError,
  reply: FastifyReply,
): unknown {
  if (err.status === 400) {
    return reply.status(400).send({
      error: { code: "INVALID_REPOSITORY", message: err.message },
    });
  }
  if (err.status === 401) {
    return reply.status(502).send({
      error: {
        code: "GITHUB_AUTH_FAILED",
        message:
          "GitHub credential is invalid or missing — please sign in with GitHub again.",
      },
    });
  }
  if (err.rateLimited || err.status === 429) {
    return reply.status(429).send({
      error: {
        code: "GITHUB_RATE_LIMITED",
        message: "GitHub rate limit exceeded — try again shortly.",
      },
    });
  }
  if (err.status === 403 || err.status === 404) {
    return reply.status(404).send({
      error: {
        code: "GITHUB_REPOSITORY_NOT_FOUND",
        message: "Repository not found or not accessible.",
      },
    });
  }
  return reply.status(503).send({
    error: {
      code: "GITHUB_UNAVAILABLE",
      message: "GitHub is temporarily unavailable — try again shortly.",
    },
  });
}
