import type { FastifyReply, FastifyRequest } from "fastify";
import {
  getRawSessionToken,
  resolveSession,
} from "../services/session.service.js";
import { userHasRepositoryAccess } from "../services/repository.service.js";

/**
 * Authorization foundation. The authenticated server-side session is the
 * only source of identity — a `userId` supplied by the client is never
 * trusted as proof of ownership.
 */

/** Attach `request.user` when a valid session exists; anonymous otherwise. */
export async function authenticate(request: FastifyRequest): Promise<void> {
  const result = await resolveSession(getRawSessionToken(request));
  if (result) {
    request.user = result.user;
  }
}

/** Reject unauthenticated requests with 401. */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await resolveSession(getRawSessionToken(request));
  if (!result) {
    return reply.unauthorized("Authentication required");
  }
  request.user = result.user;
}

/**
 * Require an authorized user→repository relationship.
 * Use after `requireAuth`. Unknown IDs and unauthorized access both yield
 * 404 so the existence of other users' repositories is not leaked.
 */
export async function requireRepositoryAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = request.user;
  if (!user) {
    return reply.unauthorized("Authentication required");
  }
  const { id } = request.params as { id: string };
  const allowed = await userHasRepositoryAccess(user.id, id);
  if (!allowed) {
    return reply.notFound("Repository not found");
  }
}
