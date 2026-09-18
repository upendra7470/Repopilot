import type { SafeUser } from "../services/session.service.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Authenticated user set by `requireAuth`. Absent when anonymous. */
    user?: SafeUser;
  }
}

export type { SafeUser };
