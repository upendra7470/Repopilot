import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GithubApiError } from "../services/github-provider.js";
import { discoverRepositories } from "../services/github-repos.service.js";
import { requireAuth } from "../middleware/auth.js";
import { sendGithubError } from "./github-errors.js";

const discoveryQuerySchema = z.object({
  query: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).max(100).optional(),
  per_page: z.coerce.number().int().min(1).max(50).optional(),
});

/**
 * Read-only GitHub repository discovery for the authenticated user.
 * Uses the server-side stored credential; the token never reaches the
 * client. Bounded + explicitly paginated so large accounts stay usable.
 */
export async function githubRoutes(app: FastifyInstance): Promise<void> {
  app.get("/github/repositories", {
    preHandler: [requireAuth],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: {
      querystring: {
        type: "object",
        properties: {
          query: { type: "string" },
          page: { type: "number" },
          per_page: { type: "number" },
        },
      },
      response: {
        200: {
          type: "object",
          required: ["data", "pagination"],
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "id",
                  "owner",
                  "name",
                  "fullName",
                  "isPrivate",
                  "htmlUrl",
                  "connected",
                ],
                properties: {
                  id: { type: "number" },
                  owner: { type: "string" },
                  name: { type: "string" },
                  fullName: { type: "string" },
                  description: { type: ["string", "null"] },
                  isPrivate: { type: "boolean" },
                  defaultBranch: { type: "string" },
                  htmlUrl: { type: "string" },
                  archived: { type: "boolean" },
                  fork: { type: "boolean" },
                  updatedAt: { type: ["string", "null"] },
                  connected: { type: "boolean" },
                },
              },
            },
            pagination: {
              type: "object",
              required: ["page", "perPage", "total"],
              properties: {
                page: { type: "number" },
                perPage: { type: "number" },
                total: { type: "number" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const parsed = discoveryQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.badRequest(
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }

      try {
        const result = await discoverRepositories(request.user!.id, {
          query: parsed.data.query,
          page: parsed.data.page,
          perPage: parsed.data.per_page,
        });
        return reply.send(result);
      } catch (err) {
        if (err instanceof GithubApiError) {
          return sendGithubError(err, reply);
        }
        throw err;
      }
    },
  });
}
