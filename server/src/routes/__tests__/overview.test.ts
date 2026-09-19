import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";
import {
  createRepository,
  linkUserRepository,
} from "../../services/repository.service.js";
import { getDb } from "../../db/index.js";
import { commits } from "../../db/schema.js";

describe("Repository overview and events API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects anonymous access", async () => {
    const base = "/api/repositories/00000000-0000-0000-0000-000000000000";
    expect((await app.inject({ method: "GET", url: `${base}/overview` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `${base}/events` })).statusCode).toBe(401);
  });

  it("rejects strangers with 404 and strangers' data stays isolated", async () => {
    const owner = await loginTestUser();
    const stranger = await loginTestUser();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const record = await createRepository({
      githubId: `gh-ov-route-${suffix}`,
      owner: "o",
      name: `r-${suffix}`,
      fullName: `o/r-${suffix}`,
    });
    await linkUserRepository(owner.user.id, record.id, "owner");
    await getDb().insert(commits).values({
      repositoryId: record.id,
      sha: "d".repeat(40),
      message: "owner only",
      committedAt: new Date(),
    });

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/overview`,
          headers: { cookie: stranger.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/${record.id}/events`,
          headers: { cookie: stranger.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("serves a real aggregate and event stream to the owner", async () => {
    const login = await loginTestUser();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const record = await createRepository({
      githubId: `gh-ov-route2-${suffix}`,
      owner: "o",
      name: `r2-${suffix}`,
      fullName: `o/r2-${suffix}`,
    });
    await linkUserRepository(login.user.id, record.id, "owner");
    await getDb().insert(commits).values({
      repositoryId: record.id,
      sha: "e".repeat(40),
      message: "seed commit",
      authorLogin: "alice",
      committedAt: new Date(),
    });
    const headers = { cookie: login.cookie };

    const overview = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/overview`,
      headers,
    });
    expect(overview.statusCode).toBe(200);
    const body = JSON.parse(overview.payload);
    expect(body.repository).toMatchObject({ id: record.id, fullName: record.fullName });
    expect(body.counts.commits).toBe(1);
    expect(body.recentEvents.map((e: { kind: string }) => e.kind)).toEqual(["commit"]);
    expect(body.recentEvents[0].ref).toEqual({ entity: "commit", value: "e".repeat(40) });
    expect(body.payload ?? null).toBeNull();
    expect(overview.payload).not.toContain("accessToken");

    const events = await app.inject({
      method: "GET",
      url: `/api/repositories/${record.id}/events?limit=10`,
      headers,
    });
    expect(events.statusCode).toBe(200);
    expect(JSON.parse(events.payload)).toHaveLength(1);

    // Repository access is verified before id shape (privacy-preserving
    // 404, same convention as the sibling detail endpoint).
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/repositories/not-a-uuid/overview`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
  });
});
