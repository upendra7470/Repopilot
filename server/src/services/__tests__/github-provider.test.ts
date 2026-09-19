import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchGithubCommitFiles,
  fetchGithubPullRequest,
  fetchGithubRepoMetadata,
  fetchGithubTree,
  getGithubRepository,
  listGithubBranches,
  listGithubCommits,
  listGithubPullCommits,
  listGithubPullFiles,
  listGithubPullRequests,
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

  it("detects GitHub rate limiting after retries are exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({}, 403, { "x-ratelimit-remaining": "0" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const err = await listGithubRepositories("token").catch((e) => e);
    expect(err).toBeInstanceOf(GithubApiError);
    expect(err.status).toBe(429);
    expect(err.rateLimited).toBe(true);
    // Transient failures are retried (max 3 attempts), never looped forever.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("recovers when a rate limit clears on retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({}, 403, { "x-ratelimit-remaining": "0" }),
      )
      .mockResolvedValueOnce(jsonResponse([repoJson(7)]));
    vi.stubGlobal("fetch", fetchMock);

    const repos = await listGithubRepositories("token");

    expect(repos).toHaveLength(1);
    expect(repos[0].id).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry authentication failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    vi.stubGlobal("fetch", fetchMock);

    const err = await listGithubRepositories("token").catch((e) => e);
    expect(err).toBeInstanceOf(GithubApiError);
    expect(err.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("lists pull requests across pages", async () => {
    const pr = (n: number) => ({
      id: 5000 + n,
      number: n,
      title: `PR ${n}`,
      body: null,
      state: "open",
      draft: false,
      user: { login: "alice", id: 1 },
      head: { ref: `feature-${n}`, sha: "a".repeat(40) },
      base: { ref: "main", sha: "b".repeat(40) },
      html_url: `https://github.com/o/r/pull/${n}`,
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-02T10:00:00Z",
      closed_at: null,
      merged_at: null,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 50 }, (_, i) => pr(i + 1))))
      .mockResolvedValueOnce(jsonResponse([pr(51)]));
    vi.stubGlobal("fetch", fetchMock);

    const prs = await listGithubPullRequests("token", "o", "r");

    expect(prs).toHaveLength(51);
    expect(prs[0]).toMatchObject({ number: 1, authorLogin: "alice" });
    expect(fetchMock.mock.calls[0][0]).toContain("state=all");
  });

  it("fetches full PR detail with diff stats", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          id: 5001,
          number: 1,
          title: "Big change",
          body: "body",
          state: "open",
          draft: false,
          merged: false,
          user: { login: "bob", id: 2 },
          head: { ref: "feat", sha: "c".repeat(40) },
          base: { ref: "main", sha: "d".repeat(40) },
          merge_commit_sha: null,
          html_url: "https://github.com/o/r/pull/1",
          additions: 183,
          deletions: 72,
          changed_files: 4,
          created_at: "2026-09-01T10:00:00Z",
          updated_at: "2026-09-02T10:00:00Z",
          closed_at: null,
          merged_at: null,
        }),
      ),
    );

    const detail = await fetchGithubPullRequest("token", "o", "r", 1);

    expect(detail).toMatchObject({
      additions: 183,
      deletions: 72,
      changedFiles: 4,
      merged: false,
    });
  });

  it("lists PR commits and files with metadata only", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            sha: "e".repeat(40),
            commit: {
              message: "c1",
              author: { name: "A", email: "a@x", date: "2026-09-01T10:00:00Z" },
              committer: { name: "A", email: "a@x", date: "2026-09-01T10:00:00Z" },
            },
            author: { login: "alice", id: 1, avatar_url: null },
            committer: null,
            html_url: "https://github.com/o/r/commit/eee",
            parents: [],
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            filename: "src/a.ts",
            previous_filename: "src/old.ts",
            sha: "f".repeat(40),
            status: "renamed",
            additions: 5,
            deletions: 5,
            changes: 10,
            patch: "@@ should never be stored @@",
          },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const commits = await listGithubPullCommits("token", "o", "r", 1);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe("e".repeat(40));

    const changedFiles = await listGithubPullFiles("token", "o", "r", 1);
    expect(changedFiles).toHaveLength(1);
    expect(changedFiles[0]).toMatchObject({
      path: "src/a.ts",
      previousPath: "src/old.ts",
      status: "renamed",
    });
    expect(changedFiles[0]).not.toHaveProperty("patch");
  });

  it("maps PR 404s with status preserved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({}, 404)));

    const err = await fetchGithubPullRequest("token", "o", "r", 999).catch((e) => e);
    expect(err).toBeInstanceOf(GithubApiError);
    expect(err.status).toBe(404);
  });

  it("fetches branches with protection state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse([
          { name: "main", commit: { sha: "a".repeat(40) }, protected: true },
          { name: "dev", commit: { sha: "b".repeat(40) } },
        ]),
      ),
    );

    const branches = await listGithubBranches("token", "o", "r");

    expect(branches).toHaveLength(2);
    expect(branches[0]).toMatchObject({
      name: "main",
      sha: "a".repeat(40),
      isProtected: true,
    });
    expect(branches[1].isProtected).toBe(false);
  });

  it("fetches commits with author identity and parents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse([
          {
            sha: "c".repeat(40),
            commit: {
              message: "feat: x",
              author: {
                name: "A U Thor",
                email: "a@example.com",
                date: "2026-09-01T10:00:00Z",
              },
              committer: {
                name: "GitHub",
                email: "noreply@github.com",
                date: "2026-09-01T10:00:00Z",
              },
            },
            author: { login: "author", id: 101, avatar_url: "https://x/y.png" },
            committer: null,
            html_url: "https://github.com/o/r/commit/ccc",
            parents: [{ sha: "d".repeat(40) }],
          },
        ]),
      ),
    );

    const commits = await listGithubCommits("token", "o", "r");

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      sha: "c".repeat(40),
      message: "feat: x",
      url: "https://github.com/o/r/commit/ccc",
      parents: ["d".repeat(40)],
    });
    expect(commits[0].author).toMatchObject({
      name: "A U Thor",
      email: "a@example.com",
      login: "author",
      githubId: 101,
    });
  });

  it("passes since/sha filters to the commits endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await listGithubCommits("token", "o", "r", {
      sha: "main",
      since: "2026-09-01T00:00:00.000Z",
    });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("sha=main");
    expect(url).toContain("since=2026-09-01");
  });

  it("fetches a recursive tree with truncation flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          truncated: true,
          tree: [
            { path: "README.md", sha: "e".repeat(40), type: "blob", size: 42, mode: "100644" },
            { path: "src", sha: "f".repeat(40), type: "tree", mode: "040000" },
          ],
        }),
      ),
    );

    const tree = await fetchGithubTree("token", "o", "r", "abc123");

    expect(tree.truncated).toBe(true);
    expect(tree.entries).toHaveLength(2);
    expect(tree.entries[0]).toMatchObject({
      path: "README.md",
      type: "blob",
      size: 42,
    });
  });

  it("fetches commit file metadata without patches", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        files: [
          {
            filename: "src/index.ts",
            sha: "1".repeat(40),
            status: "modified",
            additions: 10,
            deletions: 2,
            patch: "@@ huge diff @@",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const changed = await fetchGithubCommitFiles("token", "o", "r", "abc");

    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      path: "src/index.ts",
      status: "modified",
      additions: 10,
      deletions: 2,
    });
    expect(changed[0]).not.toHaveProperty("patch");
  });

  it("fetches repository metadata for sync", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          ...repoJson(9, "meta"),
          default_branch: "develop",
          updated_at: "2026-09-02T00:00:00Z",
        }),
      ),
    );

    const meta = await fetchGithubRepoMetadata("token", "octocat", "meta");

    expect(meta).toMatchObject({
      id: 9,
      defaultBranch: "develop",
      isPrivate: false,
    });
  });
});
