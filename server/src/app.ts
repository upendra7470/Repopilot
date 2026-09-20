import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import fastifyCookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import oauthPlugin from "@fastify/oauth2";
import { getEnv } from "./config/env.js";
import { getLogger } from "./utils/logger.js";
import { getAuthSecret } from "./auth/crypto.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes, GITHUB_OAUTH_SCOPES } from "./routes/auth.js";
import { githubRoutes } from "./routes/github.js";
import { memoryRoutes } from "./routes/memory.js";
import { riskRoutes } from "./routes/risks.js";
import { pullRequestRoutes } from "./routes/pulls.js";
import { issueRoutes } from "./routes/issues.js";
import { ciRoutes } from "./routes/ci.js";
import { incidentRoutes } from "./routes/incidents.js";
import { briefRoutes } from "./routes/brief.js";
import { askRoutes } from "./routes/ask.js";
import { graphRoutes } from "./routes/graph.js";
import { userRoutes } from "./routes/users.js";
import { repositoryRoutes } from "./routes/repositories.js";
import "./types/fastify.js";

/** Structural view of the plugin's built-in GitHub endpoints. */
interface OAuthProviderConfiguration {
  tokenHost: string;
  tokenPath?: string;
  revokePath?: string;
  authorizeHost?: string;
  authorizePath?: string;
}

const { GITHUB_CONFIGURATION } = oauthPlugin as unknown as {
  GITHUB_CONFIGURATION: OAuthProviderConfiguration;
};

export async function buildApp(): Promise<FastifyInstance> {
  const env = getEnv();
  const logger = getLogger();

  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : undefined,
    trustProxy: true,
  });

  if (env.NODE_ENV !== "test") {
    app.log = logger;
  }

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });

  await app.register(sensible);

  // Baseline security headers. Content-Security-Policy is left off because
  // this server only serves JSON (no HTML); the Vite frontend serves its own
  // document. Request bodies are capped by Fastify's default 1 MiB limit.
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Opt-in rate limiting; abuse-sensitive auth routes enable it per-route.
  // No distributed store (no Redis): single-instance in-memory counters.
  await app.register(rateLimit, { global: false });

  // Signed session cookies. Must precede @fastify/oauth2, which relies on
  // cookies for OAuth state/PKCE verification.
  await app.register(fastifyCookie, {
    secret: getAuthSecret(),
  });

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    await app.register(oauthPlugin, {
      name: "githubOAuth2",
      scope: [...GITHUB_OAUTH_SCOPES],
      credentials: {
        client: {
          id: env.GITHUB_CLIENT_ID,
          secret: env.GITHUB_CLIENT_SECRET,
        },
        auth: GITHUB_CONFIGURATION,
      },
      callbackUri:
        env.GITHUB_REDIRECT_URI ??
        `http://localhost:${env.PORT}/api/auth/github/callback`,
      cookie: {
        sameSite: "lax",
        httpOnly: true,
        secure: env.NODE_ENV === "production",
      },
    });
  } else {
    logger.warn(
      "GitHub OAuth is not configured (GITHUB_CLIENT_ID / " +
        "GITHUB_CLIENT_SECRET missing). Login endpoints will report " +
        "setup requirements instead of authenticating.",
    );
  }

  // Applied directly to the root instance (not via register): Fastify
  // encapsulates plugin hooks/error handlers, so registering these as
  // plugins would leave real routes on the default handlers. Calling them
  // here makes error shaping and request logging truly global.
  await errorHandler(app);
  await requestLogger(app);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api" });
  await app.register(githubRoutes, { prefix: "/api" });
  await app.register(memoryRoutes, { prefix: "/api" });
  await app.register(riskRoutes, { prefix: "/api" });
  await app.register(pullRequestRoutes, { prefix: "/api" });
  await app.register(issueRoutes, { prefix: "/api" });
  await app.register(ciRoutes, { prefix: "/api" });
  await app.register(incidentRoutes, { prefix: "/api" });
  await app.register(briefRoutes, { prefix: "/api" });
  await app.register(askRoutes, { prefix: "/api" });
  await app.register(graphRoutes, { prefix: "/api" });
  await app.register(userRoutes, { prefix: "/api" });
  await app.register(repositoryRoutes, { prefix: "/api" });

  return app;
}
