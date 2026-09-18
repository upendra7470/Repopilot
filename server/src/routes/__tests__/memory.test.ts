import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";
import {
  createRepository,
  linkUserRepository,
} from "../../services/repository.service.js";
import { getDb } from "../../db/index.js";
import {
  branches,
  commits,
  commitFiles,
  contributors,
  files,
} from "../../db/schema.js";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("Engineering memory API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seededRepo(userId: string) {
    const suffix = uniqueSuffix();
    const record = await createRepository({
      githubId: `gh-mem-api-${suffix}`,
      owner: "o",
      name: `r-${suffix}`,
      fullName: `o/r-${suffix}`,
    });
    await linkUserRepository(userId, record.id, "owner");
    const db = getDb();

    const [person] = await db
      .insert(contributors)
      .values({ repositoryId: record.id, githubId: "9", login: "carol" })
      .returning({ id: contributors.id });
    const [commit] = await db
      .insert(commits)
      .values({
        repositoryId: record.id,
        sha: "a".repeat(40),
        message: "fix memory leak",
        authorLogin: "carol",
        contributorId: person.id,
        committedAt: new Date("2026-09-03T10:00:00Z"),
      })
      .returning({ id: commits.id });
    await db.insert(commitFiles).values({
      commitId: commit.id,
      repositoryId: record.id,
      path: "src/mem/store.ts",
      status: "added",
      additions: 20,
      deletions: 0,
    });
    const [file] = await db
      .insert(files)
      .values({
        repositoryId: record.id,
        ref: "main",
        path: "src/mem/store.ts",
        type: "blob",
        size: 20,
      })
      .returning({ id: files.id });
    await db.insert(branches).values({
      repositoryId: record.id,
      name: "main",
      sha: "a".repeat(40),
    });
    return { record, personId: person.id, fileId: file.id };
  }

  it("rejects anonymous memory access", async () => {
    const urls = [
      "/api/repositories/00000000-0000-0000-0000-000000000000/memory",
      "/api/repositories/00000000-0000-0000-0000-000000000000/timeline",
      "/api/repositories/00000000-0000-0000-0000-000000000000/files",
      "/api/repositories/00000000-0000-0000-0000-000000000000/contributors",
      "/api/repositories/00000000-0000-0000-0000-000000000000/activity?q=x",
      "/api/repositories/00000000-0000-0000-0000-000000000000/changed-files",
    ];
    for (const url of urls) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(401);
    }
  });

  it("rejects strangers with privacy-preserving 404", async () => {
    const owner = await loginTestUser();
    const stranger = await loginTestUser();
    const { record } = await seededRepo(owner.user.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/memory`,
      headers: { cookie: stranger.cookie },
    });
    expect(response.statusCode).toBe(404);
  });

  it("serves memory overview from real records", async () => {
    const login = await loginTestUser();
    const { record } = await seededRepo(login.user.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/memory`,
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.counts).toMatchObject({
      branches: 1,
      commits: 1,
      files: 1,
      contributors: 1,
    });
    expect(body.recentActivity[0].title).toBe("fix memory leak");
    expect(body.frequentlyChangedFiles[0].path).toBe("src/mem/store.ts");
    expect(body.activeContributors[0].login).toBe("carol");
    expect(body.areas).toEqual([{ area: "src", files: 1, changes: 1 }]);
  });

  it("serves timeline, files, and change stats", async () => {
    const login = await loginTestUser();
    const { record } = await seededRepo(login.user.id);
    const headers = { cookie: login.cookie };

    const timeline = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/timeline?limit=5`,
      headers,
    });
    expect(timeline.statusCode).toBe(200);
    expect(JSON.parse(timeline.payload)[0].kind).toBe("commit");

    const fileList = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/files`,
      headers,
    });
    expect(fileList.statusCode).toBe(200);
    expect(JSON.parse(fileList.payload).map((f: { path: string }) => f.path)).toEqual([
      "src/mem/store.ts",
    ]);

    const changed = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/changed-files`,
      headers,
    });
    expect(changed.statusCode).toBe(200);
    expect(JSON.parse(changed.payload)[0]).toMatchObject({
      path: "src/mem/store.ts",
      changes: 1,
    });
  });

  it("serves file history with validation", async () => {
    const login = await loginTestUser();
    const { record, fileId } = await seededRepo(login.user.id);
    const headers = { cookie: login.cookie };

    const history = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/files/${fileId}/history`,
      headers,
    });
    expect(history.statusCode).toBe(200);
    const body = JSON.parse(history.payload);
    expect(body.changeCount).toBe(1);
    expect(body.contributors).toEqual([{ login: "carol", changes: 1 }]);
    expect(body.latestChange.sha).toBe("a".repeat(40));

    const unknown = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/files/00000000-0000-0000-0000-000000000000/history`,
      headers,
    });
    expect(unknown.statusCode).toBe(404);

    const malformed = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/files/nope/history`,
      headers,
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("serves contributor activity with validation", async () => {
    const login = await loginTestUser();
    const { record, personId } = await seededRepo(login.user.id);
    const headers = { cookie: login.cookie };

    const list = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/contributors`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.payload)[0].login).toBe("carol");

    const detail = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/contributors/${personId}`,
      headers,
    });
    expect(detail.statusCode).toBe(200);
    const body = JSON.parse(detail.payload);
    expect(body).toMatchObject({ commitCount: 1, filesTouched: 1 });
    expect(body.frequentAreas).toEqual([{ area: "src", changes: 1 }]);
    expect(body).not.toHaveProperty("score");

    const unknown = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/contributors/00000000-0000-0000-0000-000000000000`,
      headers,
    });
    expect(unknown.statusCode).toBe(404);

    const malformed = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/contributors/nope`,
      headers,
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("searches memory and validates the query", async () => {
    const login = await loginTestUser();
    const { record } = await seededRepo(login.user.id);
    const headers = { cookie: login.cookie };

    const search = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/activity?q=mem`,
      headers,
    });
    expect(search.statusCode).toBe(200);
    const body = JSON.parse(search.payload);
    expect(body.files.map((f: { path: string }) => f.path)).toEqual([
      "src/mem/store.ts",
    ]);
    expect(body.commits).toHaveLength(1);

    const missing = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/activity`,
      headers,
    });
    expect(missing.statusCode).toBe(400);
  });
});
