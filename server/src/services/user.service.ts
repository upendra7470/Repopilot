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

export async function getUserByGithubId(githubId: string) {
  const logger = getLogger();
  const db = getDb();

  logger.debug("Fetching user by GitHub ID");
  const result = await db
    .select()
    .from(users)
    .where(eq(users.githubId, githubId))
    .limit(1);
  return result[0] ?? null;
}

export interface UpdateUserInput {
  login?: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

export async function updateUser(id: string, data: UpdateUserInput) {
  const logger = getLogger();
  const db = getDb();

  logger.debug({ id }, "Updating user");
  const result = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
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
