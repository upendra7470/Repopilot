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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Require an authorized user→repository relationship.
 * Use after `requireAuth`. Unknown IDs, malformed IDs, and unauthorized
 * access all yield 404 so the existence of other users' repositories is
 * not leaked (and malformed IDs never reach the database).
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
  // Envelope shape (not reply.notFound) so routes declaring error schemas
  // can serialize this response.
  const notFound = () =>
    reply.status(404).send({
      error: { code: "REPOSITORY_NOT_FOUND", message: "Repository not found" },
    });
  if (!UUID_PATTERN.test(id)) {
    return notFound();
  }
  const allowed = await userHasRepositoryAccess(user.id, id);
  if (!allowed) {
    return notFound();
  }
}
