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

    await migrate(db, { migrationsFolder: "./src/db/migrations" });

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
