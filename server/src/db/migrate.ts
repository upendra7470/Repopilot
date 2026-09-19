import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { getEnv } from "../config/env.js";
import { getLogger } from "../utils/logger.js";

async function runMigrations() {
  const env = getEnv();
  const logger = getLogger();

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
  });

  const db = drizzle(pool);

  try {
    logger.info("Running pending database migrations...");

    // Resolve relative to this module so `npm run db:migrate` works from
    // the repository root as documented (cwd-relative paths break there).
    const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "migrations");
    await migrate(db, { migrationsFolder });

    logger.info("Database migrations completed successfully");
  } catch (err) {
    logger.error({ err }, "Database migration failed");
    throw err;
  } finally {
    await pool.end();
  }
}

runMigrations()
  .then(() => {
    process.exit(0);
  })
  .catch(() => {
    process.exit(1);
  });
