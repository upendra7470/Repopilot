import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { sign } from "@fastify/cookie";
import { buildTestApp, loginTestUser, TEST_AUTH_SECRET } from "./helpers.js";

const FORBIDDEN_KEYS = [
  "accessToken",
  "access_token",
  "client_secret",
  "clientSecret",
  "tokenHash",
  "password",
];

function assertNoSecrets(payload: string): void {
  for (const key of FORBIDDEN_KEYS) {
    expect(payload).not.toContain(key);
  }
}

describe("Authentication API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/auth/session reports unauthenticated without a cookie", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body).toEqual({ authenticated: false, user: null });
  });

  it("GET /api/auth/session resolves the user for a valid session", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.authenticated).toBe(true);
    expect(body.user.id).toBe(login.user.id);
    expect(body.user.login).toBe(login.user.login);
    expect(body.user.name).toBe("Test User");
    assertNoSecrets(response.payload);
  });

  it("GET /api/auth/session accepts the signed cookie browsers send", async () => {
    const login = await loginTestUser();
    const signed = sign(login.sessionToken, TEST_AUTH_SECRET);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: `repopilot_session=${signed}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.authenticated).toBe(true);
    expect(body.user.id).toBe(login.user.id);
  });

  it("GET /api/auth/session rejects a tampered signed cookie", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: `repopilot_session=${login.sessionToken}.tampered` },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      authenticated: false,
      user: null,
    });
  });

  it("GET /api/auth/session rejects an invalid session token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: "repopilot_session=invalid-token-value" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      authenticated: false,
      user: null,
    });
  });

  it("GET /api/auth/github reports setup requirements when unconfigured", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/github",
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.payload);
    expect(body.error.code).toBe("OAUTH_NOT_CONFIGURED");
    assertNoSecrets(response.payload);
  });

  it("POST /api/auth/logout invalidates the session", async () => {
    const login = await loginTestUser();

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: login.cookie },
    });
    expect(logoutResponse.statusCode).toBe(200);

    const setCookie = logoutResponse.headers["set-cookie"];
    expect(setCookie).toBeDefined();

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: login.cookie },
    });
    expect(JSON.parse(sessionResponse.payload)).toEqual({
      authenticated: false,
      user: null,
    });
  });

  it("POST /api/auth/logout without a session still succeeds", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });
  });

  it("protected APIs reject unauthenticated requests with 401", async () => {
    for (const url of ["/api/users", "/api/repositories"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(401);
    }

    const postResponse = await app.inject({
      method: "POST",
      url: "/api/repositories",
      payload: { owner: "x", name: "y", fullName: "x/y" },
    });
    expect(postResponse.statusCode).toBe(401);
  });

  it("error responses do not leak secrets", async () => {
    const login = await loginTestUser();

    const response = await app.inject({
      method: "GET",
      url: "/api/users/not-a-uuid",
      headers: { cookie: login.cookie },
    });

    expect(response.statusCode).toBe(400);
    assertNoSecrets(response.payload);
  });
});
