import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://localhost:5432/repopilot"),
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  // Secret used to sign session cookies and to encrypt stored OAuth
  // credentials. Optional so local development works out of the box; when
  // absent an ephemeral per-process secret is generated (sessions do not
  // survive restarts) and a warning is logged. Set a stable value in
  // production.
  AUTH_SECRET: z.string().min(32).optional(),
  // GitHub OAuth application credentials. Optional: when absent, the
  // login endpoints report "not configured" instead of faking auth.
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  // Public backend callback URL registered in the GitHub OAuth app.
  // Defaults to the local backend; override in deployed environments.
  GITHUB_REDIRECT_URI: z.string().url().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(168),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const formatted = Object.entries(errors)
      .map(([key, msgs]) => `  ${key}: ${msgs?.join(", ")}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }

  return result.data;
}

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = loadEnv();
  }
  return _env;
}

export function resetEnv(): void {
  _env = null;
}
