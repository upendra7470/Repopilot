import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://localhost:5432/repopilot_test";

// Set DATABASE_URL before importing services
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  createRepository,
  getRepositoryById,
  getRepositoryByFullName,
  listRepositories,
} from "../repository.service.js";
import { createUser } from "../user.service.js";
import { userRepositories } from "../../db/schema.js";
import { getDb } from "../../db/index.js";
import * as schema from "../../db/schema.js";

let pool: Pool;
let _db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DATABASE_URL });
  _db = drizzle(pool, { schema });
});

afterAll(async () => {
  await pool.end();
});

describe("RepositoryService", () => {
  const uniqueSuffix = Date.now() + "-" + Math.random().toString(36).slice(2);
  const testRepo = {
    owner: "testorg",
    name: "testrepo-" + uniqueSuffix,
    fullName: "testorg/testrepo-" + uniqueSuffix,
    description: "A test repository",
    defaultBranch: "main",
    isPrivate: false,
    githubId: "gh-repo-" + uniqueSuffix,
  };

  it("should create a repository", async () => {
    const repo = await createRepository(testRepo);
    expect(repo).toBeDefined();
    expect(repo.id).toBeDefined();
    expect(repo.owner).toBe(testRepo.owner);
    expect(repo.name).toBe(testRepo.name);
    expect(repo.fullName).toBe(testRepo.fullName);
    expect(repo.description).toBe(testRepo.description);
  });

  it("should get repository by id", async () => {
    const uniqueId = Date.now() + "-" + Math.random().toString(36).slice(2);
    const created = await createRepository({
      owner: "getbyid-org",
      name: "getbyid-repo-" + uniqueId,
      fullName: "getbyid-org/getbyid-repo-" + uniqueId,
    });
    const repo = await getRepositoryById(created.id);
    expect(repo).not.toBeNull();
    expect(repo!.id).toBe(created.id);
  });

  it("should get repository by full name", async () => {
    const repo = await getRepositoryByFullName(testRepo.fullName);
    expect(repo).not.toBeNull();
    expect(repo!.fullName).toBe(testRepo.fullName);
  });

  it("should list repositories", async () => {
    const repos = await listRepositories();
    expect(Array.isArray(repos)).toBe(true);
    expect(repos.length).toBeGreaterThan(0);
  });

  it("should handle user-repository relationship", async () => {
    const uniqueId = Date.now() + "-" + Math.random().toString(36).slice(2);
    const user = await createUser({
      login: "repo-user-" + uniqueId,
      name: "Repo User",
    });

    const repo = await createRepository({
      owner: "rel-org",
      name: "rel-repo-" + uniqueId,
      fullName: "rel-org/rel-repo-" + uniqueId,
    });

    const dbInstance = getDb();
    await dbInstance.insert(userRepositories).values({
      userId: user.id,
      repositoryId: repo.id,
      role: "owner",
    });

    const result = await dbInstance
      .select()
      .from(userRepositories)
      .where(
        eq(userRepositories.userId, user.id) &&
          eq(userRepositories.repositoryId, repo.id),
      )
      .limit(1);

    expect(result.length).toBe(1);
    expect(result[0].role).toBe("owner");
  });
});
