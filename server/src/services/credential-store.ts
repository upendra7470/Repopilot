import { and, eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { oauthAccounts } from "../db/schema.js";
import { encryptSecret, decryptSecret } from "../auth/crypto.js";
import { getLogger } from "../utils/logger.js";

/**
 * Controlled server-side boundary for provider credentials.
 *
 * Future GitHub API code (Phase 4+) must obtain credentials through this
 * module — never by reading the oauth_accounts table directly. Tokens are
 * stored AES-256-GCM encrypted, are never logged, and are never returned
 * through API responses.
 */
export const GITHUB_PROVIDER = "github";

export async function setGithubCredential(
  userId: string,
  providerAccountId: string,
  accessToken: string,
  scope: string | null,
): Promise<void> {
  const db = getDb();
  const encrypted = encryptSecret(accessToken);

  const existing = await db
    .select({ id: oauthAccounts.id })
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.userId, userId),
        eq(oauthAccounts.provider, GITHUB_PROVIDER),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(oauthAccounts)
      .set({
        providerAccountId,
        accessTokenEncrypted: encrypted.ciphertext,
        accessTokenIv: encrypted.iv,
        accessTokenTag: encrypted.tag,
        scope,
        updatedAt: new Date(),
      })
      .where(eq(oauthAccounts.id, existing[0].id));
  } else {
    await db.insert(oauthAccounts).values({
      userId,
      provider: GITHUB_PROVIDER,
      providerAccountId,
      accessTokenEncrypted: encrypted.ciphertext,
      accessTokenIv: encrypted.iv,
      accessTokenTag: encrypted.tag,
      scope,
    });
  }

  // Deliberately logs only the user id — never the token.
  getLogger().debug({ userId }, "GitHub credential stored");
}

/**
 * Decrypt and return the stored GitHub access token for server-side use.
 * Returns null when no credential is stored. Callers must never expose the
 * result to clients, logs, or error messages.
 */
export async function getGithubCredential(
  userId: string,
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.userId, userId),
        eq(oauthAccounts.provider, GITHUB_PROVIDER),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (
    !row?.accessTokenEncrypted ||
    !row.accessTokenIv ||
    !row.accessTokenTag
  ) {
    return null;
  }

  return decryptSecret({
    ciphertext: row.accessTokenEncrypted,
    iv: row.accessTokenIv,
    tag: row.accessTokenTag,
  });
}

/** Whether a GitHub credential exists, without revealing it. */
export async function hasGithubCredential(userId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: oauthAccounts.id })
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.userId, userId),
        eq(oauthAccounts.provider, GITHUB_PROVIDER),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Remove the stored GitHub credential (e.g. on disconnect). */
export async function clearGithubCredential(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(oauthAccounts)
    .set({
      accessTokenEncrypted: null,
      accessTokenIv: null,
      accessTokenTag: null,
      scope: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(oauthAccounts.userId, userId),
        eq(oauthAccounts.provider, GITHUB_PROVIDER),
      ),
    );
}
