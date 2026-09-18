import { and, eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { repositories, userRepositories } from "../db/schema.js";
import { getLogger } from "../utils/logger.js";

export interface CreateRepositoryInput {
  githubId?: string;
  owner: string;
  name: string;
  fullName: string;
  description?: string | null;
  defaultBranch?: string;
  isPrivate?: boolean;
  htmlUrl?: string | null;
  archived?: boolean;
  fork?: boolean;
  connectionStatus?: string;
}

export interface UpdateRepositoryInput {
  fullName?: string;
  description?: string | null;
  defaultBranch?: string;
  isPrivate?: boolean;
  htmlUrl?: string | null;
  archived?: boolean;
  fork?: boolean;
  connectionStatus?: string;
}

export async function updateRepository(id: string, data: UpdateRepositoryInput) {
  const logger = getLogger();
  const db = getDb();

  logger.debug({ id }, "Updating repository");
  const result = await db
    .update(repositories)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(repositories.id, id))
    .returning();
  return result[0] ?? null;
}

export async function getRepositoryByGithubId(githubId: string) {
  const logger = getLogger();
  const db = getDb();

  logger.debug("Fetching repository by GitHub ID");
  const result = await db
    .select()
    .from(repositories)
    .where(eq(repositories.githubId, githubId))
    .limit(1);
  return result[0] ?? null;
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

/**
 * Whether the user has any authorized relationship to the repository.
 * Used by authorization checks; callers map "false" to 404 so the existence
 * of other users' repositories is not leaked.
 */
export async function userHasRepositoryAccess(
  userId: string,
  repositoryId: string,
): Promise<boolean> {
  const logger = getLogger();
  const db = getDb();

  logger.debug("Checking repository access");
  const rows = await db
    .select({ id: userRepositories.id })
    .from(userRepositories)
    .where(
      and(
        eq(userRepositories.userId, userId),
        eq(userRepositories.repositoryId, repositoryId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Grant a user a role on a repository (used at creation time). */
export async function linkUserRepository(
  userId: string,
  repositoryId: string,
  role = "owner",
) {
  const logger = getLogger();
  const db = getDb();

  logger.debug("Linking user to repository");
  const result = await db
    .insert(userRepositories)
    .values({ userId, repositoryId, role })
    .returning();
  return result[0];
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
      htmlUrl: repositories.htmlUrl,
      archived: repositories.archived,
      fork: repositories.fork,
      connectionStatus: repositories.connectionStatus,
      syncStatus: repositories.syncStatus,
      lastSyncedAt: repositories.lastSyncedAt,
      lastSuccessfulSyncAt: repositories.lastSuccessfulSyncAt,
      createdAt: repositories.createdAt,
      updatedAt: repositories.updatedAt,
      role: userRepositories.role,
    })
    .from(userRepositories)
    .innerJoin(repositories, eq(userRepositories.repositoryId, repositories.id))
    .where(eq(userRepositories.userId, userId));
}
