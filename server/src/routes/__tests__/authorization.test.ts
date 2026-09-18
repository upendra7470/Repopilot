import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, loginTestUser } from "./helpers.js";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("Repository authorization boundaries", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("an authenticated user can create and read their own repository", async () => {
    const owner = await loginTestUser();
    const suffix = uniqueSuffix();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/repositories",
      headers: { cookie: owner.cookie },
      payload: {
        owner: "owner-a",
        name: `repo-a-${suffix}`,
        fullName: `owner-a/repo-a-${suffix}`,
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = JSON.parse(createResponse.payload);

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/repositories/${created.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(getResponse.statusCode).toBe(200);
    expect(JSON.parse(getResponse.payload).id).toBe(created.id);
  });

  it("another user cannot read a repository they have no relationship to", async () => {
    const owner = await loginTestUser();
    const stranger = await loginTestUser();
    const suffix = uniqueSuffix();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/repositories",
      headers: { cookie: owner.cookie },
      payload: {
        owner: "owner-b",
        name: `repo-b-${suffix}`,
        fullName: `owner-b/repo-b-${suffix}`,
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = JSON.parse(createResponse.payload);

    // Privacy-preserving 404: existence is not leaked.
    const strangerResponse = await app.inject({
      method: "GET",
      url: `/api/repositories/${created.id}`,
      headers: { cookie: stranger.cookie },
    });
    expect(strangerResponse.statusCode).toBe(404);

    const anonymousResponse = await app.inject({
      method: "GET",
      url: `/api/repositories/${created.id}`,
    });
    expect(anonymousResponse.statusCode).toBe(401);
  });

  it("repository listing is scoped to the current user", async () => {
    const userA = await loginTestUser();
    const userB = await loginTestUser();
    const suffix = uniqueSuffix();

    for (const [login, owner] of [
      [userA, "scope-a"],
      [userB, "scope-b"],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url: "/api/repositories",
        headers: { cookie: login.cookie },
        payload: {
          owner,
          name: `scoped-${suffix}`,
          fullName: `${owner}/scoped-${suffix}`,
        },
      });
      expect(res.statusCode).toBe(201);
    }

    const listA = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/repositories",
          headers: { cookie: userA.cookie },
        })
      ).payload,
    ) as Array<{ fullName: string }>;
    const listB = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/repositories",
          headers: { cookie: userB.cookie },
        })
      ).payload,
    ) as Array<{ fullName: string }>;

    expect(listA.some((r) => r.fullName === `scope-a/scoped-${suffix}`)).toBe(
      true,
    );
    expect(listA.some((r) => r.fullName === `scope-b/scoped-${suffix}`)).toBe(
      false,
    );
    expect(listB.some((r) => r.fullName === `scope-b/scoped-${suffix}`)).toBe(
      true,
    );
    expect(listB.some((r) => r.fullName === `scope-a/scoped-${suffix}`)).toBe(
      false,
    );
  });

  it("a forged user id does not grant access to another user's repositories", async () => {
    const victim = await loginTestUser();
    const attacker = await loginTestUser();

    const ownResponse = await app.inject({
      method: "GET",
      url: `/api/users/${attacker.user.id}/repositories`,
      headers: { cookie: attacker.cookie },
    });
    expect(ownResponse.statusCode).toBe(200);

    const forgedResponse = await app.inject({
      method: "GET",
      url: `/api/users/${victim.user.id}/repositories`,
      headers: { cookie: attacker.cookie },
    });
    expect(forgedResponse.statusCode).toBe(404);
  });
});
