import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";
import { getEnv } from "../config/env.js";
import { getLogger } from "../utils/logger.js";

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function createConnection() {
  const env = getEnv();
  const logger = getLogger();

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on("error", (err) => {
    logger.error({ err }, "Unexpected database pool error");
  });

  const db = drizzle(pool, { schema });

  return { pool, db };
}

export function getDb() {
  if (!_db) {
    const conn = createConnection();
    _pool = conn.pool;
    _db = conn.db;
  }
  return _db;
}

export function getClient(): Pool {
  if (!_pool) {
    getDb();
  }
  return _pool!;
}

export async function disconnect(): Promise<void> {
  const logger = getLogger();
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
    logger.info("Database connection pool closed");
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    const client = getClient();
    const result = await client.query("SELECT 1 AS ok");
    return result.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

export { schema };
