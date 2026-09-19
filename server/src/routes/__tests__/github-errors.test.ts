import { describe, it, expect } from "vitest";
import { sendGithubError } from "../github-errors.js";
import { GithubApiError } from "../../services/github-provider.js";

function stubReply() {
  const calls: Array<{ status: number; payload: unknown }> = [];
  const reply = {
    status(code: number) {
      return {
        send(payload: unknown) {
          calls.push({ status: code, payload });
          return payload;
        },
      };
    },
  };
  return { reply: reply as never, calls };
}

describe("GitHub error classification", () => {
  it.each([
    [400, 400, "INVALID_REPOSITORY"],
    [401, 502, "GITHUB_AUTH_FAILED"],
    [422, 400, "GITHUB_INVALID_REQUEST"],
    [429, 429, "GITHUB_RATE_LIMITED"],
    [403, 404, "GITHUB_REPOSITORY_NOT_FOUND"],
    [404, 404, "GITHUB_REPOSITORY_NOT_FOUND"],
    [500, 503, "GITHUB_UNAVAILABLE"],
    [0, 503, "GITHUB_UNAVAILABLE"],
  ])("maps GitHub %i to HTTP %i (%s)", (githubStatus, httpStatus, code) => {
    const { reply, calls } = stubReply();
    sendGithubError(new GithubApiError(githubStatus, "upstream"), reply);
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe(httpStatus);
    expect(calls[0].payload).toMatchObject({ error: { code } });
  });

  it("never leaks tokens or upstream bodies", () => {
    const { reply, calls } = stubReply();
    sendGithubError(
      new GithubApiError(401, "Bad credentials gho_secret-value"),
      reply,
    );
    expect(JSON.stringify(calls[0].payload)).not.toContain("gho_secret-value");
  });
});
