import type { FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { sessions, users, type User } from "../db/schema.js";
import {
  generateSessionToken,
  hashSessionToken,
} from "../auth/crypto.js";
import { getEnv } from "../config/env.js";

export const SESSION_COOKIE_NAME = "repopilot_session";

/** Public user fields safe to send to the browser. No credentials. */
export interface SafeUser {
  id: string;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

/** Create a persistent server-side session and return its cookie token. */
export async function createSession(userId: string): Promise<CreatedSession> {
  const env = getEnv();
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);
  await getDb().insert(sessions).values({
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt,
  });
  return { token, expiresAt };
}

export interface ResolvedSession {
  user: SafeUser;
}

/**
 * Validate a raw session token against the database.
 * Returns null for missing, unknown, or expired sessions (expired rows are
 * deleted). The token itself is never logged.
 */
export async function resolveSession(
  rawToken: string | null | undefined,
): Promise<ResolvedSession | null> {
  if (!rawToken) {
    return null;
  }
  const db = getDb();
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashSessionToken(rawToken)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }
  if (row.session.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, row.session.id));
    return null;
  }
  return { user: toSafeUser(row.user) };
}

/** Invalidate a session. Safe to call with missing/unknown tokens. */
export async function destroySession(
  rawToken: string | null | undefined,
): Promise<void> {
  if (!rawToken) {
    return;
  }
  await getDb()
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(rawToken)));
}

/**
 * Extract the raw session token from the request cookie.
 *
 * Session cookies are always set signed, so the signature is verified here
 * and tampered values are rejected. Unsigned or missing cookies yield null.
 */
export function getRawSessionToken(request: FastifyRequest): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const raw = cookies?.[SESSION_COOKIE_NAME];
  if (typeof raw !== "string" || !raw) {
    return null;
  }
  if (typeof request.unsignCookie !== "function") {
    return null;
  }
  const unsigned = request.unsignCookie(raw);
  if (!unsigned || unsigned.valid !== true) {
    return null;
  }
  return typeof unsigned.value === "string" && unsigned.value
    ? unsigned.value
    : null;
}

export function sessionCookieOptions(): {
  path: string;
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  maxAge: number;
  signed: boolean;
} {
  const env = getEnv();
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: env.SESSION_TTL_HOURS * 3600,
    signed: true,
  };
}

export async function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
): Promise<void> {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    ...sessionCookieOptions(),
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  const { path, httpOnly, sameSite, secure } = sessionCookieOptions();
  reply.clearCookie(SESSION_COOKIE_NAME, { path, httpOnly, sameSite, secure });
}
