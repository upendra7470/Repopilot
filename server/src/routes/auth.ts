import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getEnv } from "../config/env.js";
import { handleGithubIdentity } from "../services/github-auth.service.js";
import { fetchGithubProfile } from "../services/github-provider.js";
import {
  clearSessionCookie,
  destroySession,
  getRawSessionToken,
  resolveSession,
  setSessionCookie,
} from "../services/session.service.js";
import { getLogger } from "../utils/logger.js";

/**
 * GitHub OAuth scopes requested for Phase 3 (identity only):
 * - `read:user`: read the authenticated user's public profile
 *   (stable numeric ID, login, name, avatar).
 * - `user:email`: read the user's email addresses (used for the primary
 *   email when the public profile hides it).
 *
 * No repository, workflow, admin, or write scopes are requested. Later
 * phases that need repository access will expand scopes and re-authorize.
 */
export const GITHUB_OAUTH_SCOPES = ["read:user", "user:email"] as const;

/** Structural type for the registered @fastify/oauth2 namespace. */
interface GithubOAuthNamespace {
  generateAuthorizationUri(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string>;
  getAccessTokenFromAuthorizationCodeFlow(
    request: FastifyRequest,
  ): Promise<{ token: { access_token: string; scope?: unknown } }>;
}

function githubOAuth(app: FastifyInstance): GithubOAuthNamespace | undefined {
  return (app as unknown as Record<string, GithubOAuthNamespace | undefined>)[
    "githubOAuth2"
  ];
}

export function isOAuthConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/session", async (request, reply) => {
    const result = await resolveSession(getRawSessionToken(request));
    if (!result) {
      return reply.send({ authenticated: false, user: null });
    }
    return reply.send({ authenticated: true, user: result.user });
  });

  app.get(
    "/auth/github",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const oauth = githubOAuth(app);
      if (!isOAuthConfigured() || !oauth) {
        // This endpoint is entered via top-level browser navigation (the
        // login button), so redirect back into the app's login error state
        // instead of stranding the user on a raw JSON error page.
        const env = getEnv();
        return reply.redirect(
          `${env.FRONTEND_URL}/login?error=oauth_not_configured`,
        );
      }
      const authorizationUri = await oauth.generateAuthorizationUri(
        request,
        reply,
      );
      return reply.redirect(authorizationUri);
    },
  );

  app.get(
    "/auth/github/callback",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const env = getEnv();
      const oauth = githubOAuth(app);
      if (!isOAuthConfigured() || !oauth) {
        return reply.redirect(
          `${env.FRONTEND_URL}/login?error=oauth_not_configured`,
        );
      }
      try {
        const { token } =
          await oauth.getAccessTokenFromAuthorizationCodeFlow(request);
        const accessToken = token.access_token;
        const scope =
          typeof token.scope === "string"
            ? token.scope
            : Array.isArray(token.scope)
              ? token.scope.join(" ")
              : GITHUB_OAUTH_SCOPES.join(" ");

        const profile = await fetchGithubProfile(accessToken);
        const login = await handleGithubIdentity(
          {
            githubId: String(profile.id),
            login: profile.login,
            name: profile.name,
            email: profile.email,
            avatarUrl: profile.avatarUrl,
          },
          { accessToken, scope },
        );

        await setSessionCookie(reply, login.sessionToken, login.expiresAt);
        return reply.redirect(`${env.FRONTEND_URL}/`);
      } catch (err) {
        // Log a short message only: the error may wrap provider responses
        // and must never carry tokens into the logs.
        getLogger().error(
          { err: err instanceof Error ? err.message : "unknown" },
          "GitHub OAuth callback failed",
        );
        return reply.redirect(`${env.FRONTEND_URL}/login?error=oauth_failed`);
      }
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    await destroySession(getRawSessionToken(request));
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });
}
