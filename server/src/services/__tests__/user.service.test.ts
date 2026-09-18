import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://localhost:5432/repopilot_test";

// Set DATABASE_URL before importing services
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

import { Pool } from "pg";
import {
  createUser,
  getUserById,
  getUserByLogin,
  listUsers,
} from "../user.service.js";

let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DATABASE_URL });
});

afterAll(async () => {
  await pool.end();
});

describe("UserService", () => {
  const testUser = {
    login: "testuser-" + Date.now() + "-" + Math.random().toString(36).slice(2),
    name: "Test User",
    email: "test-" + Date.now() + "@example.com",
    avatarUrl: "https://example.com/avatar.png",
    githubId: "gh-" + Date.now(),
  };

  it("should create a user", async () => {
    const user = await createUser(testUser);
    expect(user).toBeDefined();
    expect(user.id).toBeDefined();
    expect(user.login).toBe(testUser.login);
    expect(user.name).toBe(testUser.name);
    expect(user.email).toBe(testUser.email);
    expect(user.avatarUrl).toBe(testUser.avatarUrl);
    expect(user.githubId).toBe(testUser.githubId);
  });

  it("should get user by id", async () => {
    const created = await createUser({
      login: "getbyid-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      name: "Get By ID",
    });
    const user = await getUserById(created.id);
    expect(user).not.toBeNull();
    expect(user!.id).toBe(created.id);
    expect(user!.login).toBe(created.login);
  });

  it("should get user by login", async () => {
    const user = await getUserByLogin(testUser.login);
    expect(user).not.toBeNull();
    expect(user!.login).toBe(testUser.login);
  });

  it("should list users", async () => {
    const users = await listUsers();
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThan(0);
  });

  it("should throw on duplicate login constraint", async () => {
    const uniqueLogin = "exact-dup-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    await createUser({ login: uniqueLogin });
    await expect(createUser({ login: uniqueLogin })).rejects.toThrow();
  });
});
