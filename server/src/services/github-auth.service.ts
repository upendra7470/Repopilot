import type { SafeUser } from "./session.service.js";
import {
  createSession,
  toSafeUser,
} from "./session.service.js";
import {
  createUser,
  getUserByGithubId,
  getUserByLogin,
  updateUser,
} from "./user.service.js";
import { setGithubCredential } from "./credential-store.js";
import { getLogger } from "../utils/logger.js";

export interface GithubIdentity {
  /** Stable GitHub numeric user ID, as a string. Never the login. */
  githubId: string;
  login: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface GithubCredential {
  accessToken: string;
  scope: string | null;
}

export interface LoginResult {
  user: SafeUser;
  sessionToken: string;
  expiresAt: Date;
  isNewUser: boolean;
}

/**
 * Find-or-create login for a verified GitHub identity.
 *
 * First login creates the RepoPilot user; repeat logins resolve the existing
 * user by stable GitHub ID (never by login, which can change) and refresh
 * safe profile fields. The GitHub access token is persisted server-side via
 * the CredentialStore and is never part of the result.
 */
export async function handleGithubIdentity(
  identity: GithubIdentity,
  credential: GithubCredential | null,
): Promise<LoginResult> {
  const logger = getLogger();
  const existing = await getUserByGithubId(identity.githubId);

  let userId: string;
  let isNewUser: boolean;
  let safeUser: SafeUser;

  if (!existing) {
    const created = await createUser({
      githubId: identity.githubId,
      login: identity.login,
      name: identity.name ?? undefined,
      email: identity.email ?? undefined,
      avatarUrl: identity.avatarUrl ?? undefined,
    });
    userId = created.id;
    isNewUser = true;
    safeUser = toSafeUser(created);
    logger.info({ userId }, "Created user from GitHub identity");
  } else {
    userId = existing.id;
    isNewUser = false;

    // Refresh safe profile fields. GitHub logins can change; guard against
    // a login that is already taken by a different user.
    let login = existing.login;
    if (identity.login && identity.login !== existing.login) {
      const conflicting = await getUserByLogin(identity.login);
      if (!conflicting || conflicting.id === existing.id) {
        login = identity.login;
      } else {
        logger.warn(
          { userId },
          "GitHub login changed to a value owned by another user; " +
            "keeping existing login",
        );
      }
    }

    const updated = await updateUser(existing.id, {
      login,
      name: identity.name ?? existing.name,
      email: identity.email ?? existing.email,
      avatarUrl: identity.avatarUrl ?? existing.avatarUrl,
    });
    safeUser = toSafeUser(updated ?? existing);
  }

  if (credential) {
    await setGithubCredential(
      userId,
      identity.githubId,
      credential.accessToken,
      credential.scope,
    );
  }

  const session = await createSession(userId);

  return {
    user: safeUser,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    isNewUser,
  };
}
