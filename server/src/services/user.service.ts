import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";
import { getLogger } from "../utils/logger.js";

export interface CreateUserInput {
  githubId?: string;
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
}

export async function getUserById(id: string) {
  const logger = getLogger();
  const db = getDb();

  logger.debug({ id }, "Fetching user by id");
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ?? null;
}

export async function getUserByLogin(login: string) {
  const logger = getLogger();
  const db = getDb();

  logger.debug({ login }, "Fetching user by login");
  const result = await db
    .select()
    .from(users)
    .where(eq(users.login, login))
    .limit(1);
  return result[0] ?? null;
}

export async function createUser(data: CreateUserInput) {
  const logger = getLogger();
  const db = getDb();

  logger.debug({ login: data.login }, "Creating user");
  const result = await db.insert(users).values(data).returning();
  return result[0];
}

export async function listUsers() {
  const logger = getLogger();
  const db = getDb();

  logger.debug("Listing all users");
  return db.select().from(users);
}
