import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createRepository,
  getRepositoryById,
  listRepositories,
  getUserRepositories,
} from "../services/repository.service.js";

const createRepositorySchema = z.object({
  owner: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  fullName: z.string().min(1),
  description: z.string().max(1000).optional(),
  defaultBranch: z.string().max(255).optional(),
  isPrivate: z.boolean().optional(),
  githubId: z.string().optional(),
});

type CreateRepositoryInput = z.infer<typeof createRepositorySchema>;

export async function repositoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/repositories", {
    schema: {
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "owner", "name", "fullName", "createdAt"],
            properties: {
              id: { type: "string" },
              owner: { type: "string" },
              name: { type: "string" },
              fullName: { type: "string" },
              description: { type: ["string", "null"] },
              defaultBranch: { type: "string" },
              isPrivate: { type: "boolean" },
              githubId: { type: ["string", "null"] },
              createdAt: { type: "string" },
            },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      const repos = await listRepositories();
      return reply.send(repos);
    },
  });

  app.get("/repositories/:id", {
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
          required: ["id", "owner", "name", "fullName", "createdAt"],
          properties: {
            id: { type: "string" },
            owner: { type: "string" },
            name: { type: "string" },
            fullName: { type: "string" },
            description: { type: ["string", "null"] },
            defaultBranch: { type: "string" },
            isPrivate: { type: "boolean" },
            githubId: { type: ["string", "null"] },
            createdAt: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const repo = await getRepositoryById(id);
      if (!repo) {
        return reply.notFound(`Repository ${id} not found`);
      }
      return reply.send(repo);
    },
  });

  app.post("/repositories", {
    schema: {
      body: {
        type: "object",
        required: ["owner", "name", "fullName"],
        properties: {
          owner: { type: "string" },
          name: { type: "string" },
          fullName: { type: "string" },
          description: { type: "string" },
          defaultBranch: { type: "string" },
          isPrivate: { type: "boolean" },
          githubId: { type: "string" },
        },
      },
      response: {
        201: {
          type: "object",
          required: ["id", "owner", "name", "fullName", "createdAt"],
          properties: {
            id: { type: "string" },
            owner: { type: "string" },
            name: { type: "string" },
            fullName: { type: "string" },
            description: { type: ["string", "null"] },
            defaultBranch: { type: "string" },
            isPrivate: { type: "boolean" },
            githubId: { type: ["string", "null"] },
            createdAt: { type: "string" },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const parsed = createRepositorySchema.safeParse(body);

      if (!parsed.success) {
        return reply.badRequest(
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }

      const input: CreateRepositoryInput = parsed.data;
      const repo = await createRepository({
        owner: input.owner,
        name: input.name,
        fullName: input.fullName,
        description: input.description,
        defaultBranch: input.defaultBranch,
        isPrivate: input.isPrivate,
        githubId: input.githubId,
      });

      return reply.status(201).send(repo);
    },
  });

  app.get("/users/:userId/repositories", {
    schema: {
      params: {
        type: "object",
        required: ["userId"],
        properties: {
          userId: { type: "string" },
        },
      },
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "owner", "name", "fullName", "createdAt"],
            properties: {
              id: { type: "string" },
              owner: { type: "string" },
              name: { type: "string" },
              fullName: { type: "string" },
              description: { type: ["string", "null"] },
              defaultBranch: { type: "string" },
              isPrivate: { type: "boolean" },
              githubId: { type: ["string", "null"] },
              role: { type: "string" },
              createdAt: { type: "string" },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const repos = await getUserRepositories(userId);
      return reply.send(repos);
    },
  });
}
