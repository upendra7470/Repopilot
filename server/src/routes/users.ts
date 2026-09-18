import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createUser,
  getUserById,
  listUsers,
} from "../services/user.service.js";

const createUserSchema = z.object({
  login: z.string().min(1).max(255),
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  githubId: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

type CreateUserInput = z.infer<typeof createUserSchema>;

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get("/users", {
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
              githubId: { type: ["string", "null"] },
              avatarUrl: { type: ["string", "null"] },
              createdAt: { type: "string" },
            },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      const users = await listUsers();
      return reply.send(users);
    },
  });

  app.get("/users/:id", {
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
            githubId: { type: ["string", "null"] },
            avatarUrl: { type: ["string", "null"] },
            createdAt: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = await getUserById(id);
      if (!user) {
        return reply.notFound(`User ${id} not found`);
      }
      return reply.send(user);
    },
  });

  app.post("/users", {
    schema: {
      body: {
        type: "object",
        required: ["login"],
        properties: {
          login: { type: "string" },
          name: { type: "string" },
          email: { type: "string" },
          githubId: { type: "string" },
          avatarUrl: { type: "string" },
        },
      },
      response: {
        201: {
          type: "object",
          required: ["id", "login", "createdAt"],
          properties: {
            id: { type: "string" },
            login: { type: "string" },
            name: { type: ["string", "null"] },
            email: { type: ["string", "null"] },
            githubId: { type: ["string", "null"] },
            avatarUrl: { type: ["string", "null"] },
            createdAt: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const parsed = createUserSchema.safeParse(body);

      if (!parsed.success) {
        return reply.badRequest(
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }

      const input: CreateUserInput = parsed.data;
      const user = await createUser({
        login: input.login,
        name: input.name,
        email: input.email,
        githubId: input.githubId,
        avatarUrl: input.avatarUrl,
      });

      return reply.status(201).send(user);
    },
  });
}
