import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { repositories, userRepositories } from "../db/schema.js";
import { getLogger } from "../utils/logger.js";

export interface CreateRepositoryInput {
  githubId?: string;
  owner: string;
  name: string;
  fullName: string;
  description?: string;
  defaultBranch?: string;
  isPrivate?: boolean;
}

export async function getRepositoryById(id: string) {
  const logger = getLogger();
  const db = getDb();

  logger.debug({ id }, "Fetching repository by id");
  const result = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, id))
    .limit(1);
  return result[0] ?? null;
}

export async function getRepositoryByFullName(fullName: string) {
  const logger = getLogger();
  const db = getDb();

  logger.debug({ fullName }, "Fetching repository by full name");
  const result = await db
    .select()
    .from(repositories)
    .where(eq(repositories.fullName, fullName))
    .limit(1);
  return result[0] ?? null;
}

export async function createRepository(data: CreateRepositoryInput) {
  const logger = getLogger();
  const db = getDb();

  logger.debug({ fullName: data.fullName }, "Creating repository");
  const result = await db.insert(repositories).values(data).returning();
  return result[0];
}

export async function listRepositories() {
  const logger = getLogger();
  const db = getDb();

  logger.debug("Listing all repositories");
  return db.select().from(repositories);
}

export async function getUserRepositories(userId: string) {
  const logger = getLogger();
  const db = getDb();

  logger.debug({ userId }, "Fetching repositories for user");
  return db
    .select({
      id: repositories.id,
      githubId: repositories.githubId,
      owner: repositories.owner,
      name: repositories.name,
      fullName: repositories.fullName,
      description: repositories.description,
      defaultBranch: repositories.defaultBranch,
      isPrivate: repositories.isPrivate,
      createdAt: repositories.createdAt,
      updatedAt: repositories.updatedAt,
      role: userRepositories.role,
    })
    .from(userRepositories)
    .innerJoin(repositories, eq(userRepositories.repositoryId, repositories.id))
    .where(eq(userRepositories.userId, userId));
}
