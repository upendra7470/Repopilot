import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getGithubRepository,
  listGithubRepositories,
  GithubApiError,
  MAX_DISCOVERY_REPOS,
} from "../github-provider.js";

function repoJson(id: number, name = `repo-${id}`) {
  return {
    id,
    owner: { login: "octocat" },
    name,
    full_name: `octocat/${name}`,
    description: `Description ${id}`,
    private: id % 2 === 0,
    default_branch: "main",
    html_url: `https://github.com/octocat/${name}`,
    archived: false,
    fork: false,
    permissions: { admin: true, push: true, pull: true },
    updated_at: "2026-09-01T00:00:00Z",
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub repository discovery provider", () => {
  it("maps repository fields and stops at a short page", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse([repoJson(1), repoJson(2)]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const repos = await listGithubRepositories("token");

    expect(repos).toHaveLength(2);
    expect(repos[0]).toMatchObject({
      id: 1,
      owner: "octocat",
      name: "repo-1",
      fullName: "octocat/repo-1",
      isPrivate: false,
      htmlUrl: "https://github.com/octocat/repo-1",
    });
    expect(repos[1].isPrivate).toBe(true);
    // Single page fetched — no further pagination needed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("per_page=100");
  });

  it("follows pagination while pages are full", async () => {
    const full = Array.from({ length: 100 }, (_, i) => repoJson(i + 1));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(full))
      .mockResolvedValueOnce(jsonResponse([repoJson(101)]));
    vi.stubGlobal("fetch", fetchMock);

    const repos = await listGithubRepositories("token");

    expect(repos).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");
  });

  it("rejects invalid credentials with a classified error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({}, 401)));

    const err = await listGithubRepositories("bad").catch((e) => e);
    expect(err).toBeInstanceOf(GithubApiError);
    expect(err.status).toBe(401);
  });

  it("detects GitHub rate limiting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({}, 403, { "x-ratelimit-remaining": "0" }),
      ),
    );

    const err = await listGithubRepositories("token").catch((e) => e);
    expect(err).toBeInstanceOf(GithubApiError);
    expect(err.status).toBe(429);
    expect(err.rateLimited).toBe(true);
  });

  it("maps upstream 404 with status preserved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({}, 404)));

    const err = await getGithubRepository("token", "o", "missing").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(GithubApiError);
    expect(err.status).toBe(404);
  });

  it("maps network failures without leaking the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("socket hang up")),
    );

    const err = await listGithubRepositories("super-secret").catch((e) => e);
    expect(err).toBeInstanceOf(GithubApiError);
    expect(err.status).toBe(0);
    expect(JSON.stringify(err)).not.toContain("super-secret");
    expect(String(err)).not.toContain("super-secret");
  });

  it("fetches a single repository for connection verification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse(repoJson(42, "hello"))),
    );

    const repo = await getGithubRepository("token", "octocat", "hello");

    expect(repo.fullName).toBe("octocat/hello");
    expect(repo.id).toBe(42);
  });

  it("exposes a sane discovery bound", () => {
    expect(MAX_DISCOVERY_REPOS).toBeLessThanOrEqual(1000);
  });
});
