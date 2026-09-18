import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createSession,
  destroySession,
  resolveSession,
  toSafeUser,
} from "../../services/session.service.js";
import { createUser } from "../../services/user.service.js";
import { getDb } from "../../db/index.js";
import { sessions } from "../../db/schema.js";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("Session management", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/repopilot_test";
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "silent";
    process.env.AUTH_SECRET = "test-only-auth-secret-at-least-32-chars!!";
  });

  it("a created session resolves to the safe user", async () => {
    const suffix = uniqueSuffix();
    const user = await createUser({ login: `sess-${suffix}` });
    const session = await createSession(user.id);

    const resolved = await resolveSession(session.token);
    expect(resolved?.user.id).toBe(user.id);
    expect(resolved?.user.login).toBe(`sess-${suffix}`);

    // Safe serialization: no hashes, tokens, or provider secrets.
    const serialized = JSON.stringify(toSafeUser(user));
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain(session.token);
  });

  it("only the token hash is stored — the raw token is not in the database", async () => {
    const suffix = uniqueSuffix();
    const user = await createUser({ login: `hash-${suffix}` });
    const session = await createSession(user.id);

    const db = getDb();
    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tokenHash).not.toContain(session.token);
      expect(row.tokenHash).toHaveLength(64);
    }
  });

  it("unknown tokens resolve to null", async () => {
    expect(await resolveSession("definitely-not-a-session")).toBeNull();
    expect(await resolveSession(null)).toBeNull();
    expect(await resolveSession("")).toBeNull();
  });

  it("expired sessions are rejected and cleaned up", async () => {
    const suffix = uniqueSuffix();
    const user = await createUser({ login: `exp-${suffix}` });
    const session = await createSession(user.id);

    const db = getDb();
    const { hashSessionToken } = await import("../../auth/crypto.js");
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.tokenHash, hashSessionToken(session.token)));

    expect(await resolveSession(session.token)).toBeNull();

    const remaining = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.tokenHash, hashSessionToken(session.token)));
    expect(remaining).toHaveLength(0);
  });

  it("destroyed sessions no longer resolve", async () => {
    const suffix = uniqueSuffix();
    const user = await createUser({ login: `del-${suffix}` });
    const session = await createSession(user.id);

    expect(await resolveSession(session.token)).not.toBeNull();
    await destroySession(session.token);
    expect(await resolveSession(session.token)).toBeNull();
  });
});
