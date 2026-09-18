import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { handleGithubIdentity } from "../../services/github-auth.service.js";
import {
  getGithubCredential,
  hasGithubCredential,
} from "../../services/credential-store.js";
import { getDb } from "../../db/index.js";
import { oauthAccounts, users } from "../../db/schema.js";

const TEST_ENV = {
  DATABASE_URL: "postgresql://localhost:5432/repopilot_test",
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  AUTH_SECRET: "test-only-auth-secret-at-least-32-chars!!",
} as const;

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("GitHub identity handling", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_ENV.DATABASE_URL;
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "silent";
    process.env.AUTH_SECRET = TEST_ENV.AUTH_SECRET;
  });

  it("first login creates a user keyed by stable GitHub ID", async () => {
    const suffix = uniqueSuffix();
    const result = await handleGithubIdentity(
      {
        githubId: `gh-first-${suffix}`,
        login: `ghuser-${suffix}`,
        name: "GitHub User",
        email: `gh-${suffix}@example.com`,
        avatarUrl: "https://example.com/avatar.png",
      },
      { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
    );

    expect(result.isNewUser).toBe(true);
    expect(result.user.login).toBe(`ghuser-${suffix}`);
    expect(result.sessionToken).toBeDefined();
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("repeat login resolves the existing user without duplicates", async () => {
    const suffix = uniqueSuffix();
    const identity = {
      githubId: `gh-repeat-${suffix}`,
      login: `repeat-${suffix}`,
      name: "Repeat User",
      email: null,
      avatarUrl: null,
    };

    const first = await handleGithubIdentity(identity, {
      accessToken: `test-only-token-a-${suffix}`,
      scope: "read:user",
    });
    const second = await handleGithubIdentity(identity, {
      accessToken: `test-only-token-b-${suffix}`,
      scope: "read:user",
    });

    expect(first.isNewUser).toBe(true);
    expect(second.isNewUser).toBe(false);
    expect(second.user.id).toBe(first.user.id);

    const db = getDb();
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.githubId, `gh-repeat-${suffix}`));
    expect(rows).toHaveLength(1);
  });

  it("repeat login refreshes safe profile fields and follows login changes", async () => {
    const suffix = uniqueSuffix();

    const first = await handleGithubIdentity(
      {
        githubId: `gh-update-${suffix}`,
        login: `old-login-${suffix}`,
        name: "Old Name",
        email: null,
        avatarUrl: null,
      },
      null,
    );

    const second = await handleGithubIdentity(
      {
        githubId: `gh-update-${suffix}`,
        login: `new-login-${suffix}`,
        name: "New Name",
        email: `new-${suffix}@example.com`,
        avatarUrl: "https://example.com/new.png",
      },
      null,
    );

    expect(second.user.id).toBe(first.user.id);
    expect(second.user.login).toBe(`new-login-${suffix}`);
    expect(second.user.name).toBe("New Name");
  });

  it("stores the GitHub credential encrypted, never in plain text", async () => {
    const suffix = uniqueSuffix();
    const plaintext = `test-only-token-plain-${suffix}`;

    const result = await handleGithubIdentity(
      {
        githubId: `gh-cred-${suffix}`,
        login: `cred-${suffix}`,
        name: null,
        email: null,
        avatarUrl: null,
      },
      { accessToken: plaintext, scope: "read:user user:email" },
    );

    expect(await hasGithubCredential(result.user.id)).toBe(true);

    const db = getDb();
    const rows = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, result.user.id));
    expect(rows).toHaveLength(1);
    // The stored value must not contain the plaintext token.
    expect(rows[0].accessTokenEncrypted).toBeDefined();
    expect(rows[0].accessTokenEncrypted).not.toContain(plaintext);

    // ...but the controlled boundary can recover it server-side.
    expect(await getGithubCredential(result.user.id)).toBe(plaintext);
  });

  it("login result never contains credential material", async () => {
    const suffix = uniqueSuffix();
    const result = await handleGithubIdentity(
      {
        githubId: `gh-safe-${suffix}`,
        login: `safe-${suffix}`,
        name: null,
        email: null,
        avatarUrl: null,
      },
      { accessToken: `test-only-token-${suffix}`, scope: "read:user" },
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(`test-only-token-${suffix}`);
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("access_token");
  });
});
