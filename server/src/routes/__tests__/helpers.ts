import { resetEnv } from "../../config/env.js";
import { resetLogger } from "../../utils/logger.js";
import { buildApp } from "../../app.js";
import { handleGithubIdentity } from "../../services/github-auth.service.js";
import type { SafeUser } from "../../services/session.service.js";
import { sign } from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

export const TEST_AUTH_SECRET = "test-only-auth-secret-at-least-32-chars!!";

export interface TestEnvOptions {
  githubConfigured?: boolean;
}

export async function buildTestApp(
  options?: TestEnvOptions,
): Promise<FastifyInstance> {
  resetEnv();
  resetLogger();

  process.env.DATABASE_URL = "postgresql://localhost:5432/repopilot_test";
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.AUTH_SECRET = TEST_AUTH_SECRET;
  process.env.FRONTEND_URL = "http://localhost:5173";

  if (options?.githubConfigured) {
    process.env.GITHUB_CLIENT_ID = "test-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
  } else {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  }

  const app = await buildApp();
  return app;
}

export interface TestLogin {
  user: SafeUser;
  cookie: string;
  sessionToken: string;
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Simulate a completed GitHub login for a fresh fake identity (test double
 * for the OAuth callback — no real GitHub interaction). The stored
 * credential uses a value that is unmistakably test-only.
 */
export async function loginTestUser(
  login?: string,
): Promise<TestLogin> {
  const suffix = uniqueSuffix();
  const result = await handleGithubIdentity(
    {
      githubId: `test-gh-${suffix}`,
      login: login ?? `testuser-${suffix}`,
      name: "Test User",
      email: `test-${suffix}@example.com`,
      avatarUrl: "https://example.com/avatar.png",
    },
    { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
  );
  return {
    user: result.user,
    sessionToken: result.sessionToken,
    // Sign exactly like the server does, so tests exercise the real
    // browser cookie path.
    cookie: `repopilot_session=${sign(result.sessionToken, TEST_AUTH_SECRET)}`,
  };
}
