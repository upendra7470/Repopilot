import type { FastifyInstance } from "fastify";
import { getUserById, listUsers } from "../services/user.service.js";
import { toSafeUser } from "../services/session.service.js";
import { requireAuth } from "../middleware/auth.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * User directory. All routes require authentication.
 *
 * Open user provisioning (POST /api/users) was removed in Phase 3: users
 * are created exclusively through the GitHub login flow, which verifies the
 * stable GitHub identity. Responses contain safe profile fields only.
 */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get("/users", {
    preHandler: [requireAuth],
    schema: {
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "login", "createdAt"],
            properties: {
              id: { type: "string" },
              login: { type: "string" },
              name: { type: ["string", "null"] },
              email: { type: ["string", "null"] },
              avatarUrl: { type: ["string", "null"] },
              createdAt: { type: "string" },
            },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      const users = await listUsers();
      return reply.send(users.map(toSafeUser));
    },
  });

  app.get("/users/:id", {
    preHandler: [requireAuth],
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          required: ["id", "login", "createdAt"],
          properties: {
            id: { type: "string" },
            login: { type: "string" },
            name: { type: ["string", "null"] },
            email: { type: ["string", "null"] },
            avatarUrl: { type: ["string", "null"] },
            createdAt: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!UUID_PATTERN.test(id)) {
        return reply.badRequest("Invalid user id");
      }
      const user = await getUserById(id);
      if (!user) {
        return reply.notFound(`User ${id} not found`);
      }
      return reply.send(toSafeUser(user));
    },
  });
}
