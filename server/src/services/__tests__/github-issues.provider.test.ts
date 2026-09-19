import { describe, it, expect, vi, afterEach } from "vitest";
import {
  GithubApiError,
  listGithubIssueComments,
  listGithubIssues,
} from "../github-provider.js";

function issueItem(number: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 1000 + number,
    number,
    title: `Issue ${number}`,
    body: "Body.",
    state: "open",
    state_reason: null,
    user: { login: "alice", id: 11 },
    author_association: "CONTRIBUTOR",
    html_url: `https://github.com/o/r/issues/${number}`,
    locked: false,
    comments: 3,
    labels: [{ name: "bug" }, "auth"],
    milestone: null,
    assignees: [{ login: "bob" }],
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    closed_at: null,
    ...overrides,
  };
}

function okJson(body: unknown, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  });
}

describe("GitHub issue provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("excludes pull requests from issue listings", async () => {
    const prShaped = issueItem(9, {
      pull_request: { url: "https://api.github.com/repos/o/r/pulls/9" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => okJson([issueItem(7), prShaped])),
    );

    const result = await listGithubIssues("token", "o", "r");
    expect(result.map((i) => i.number)).toEqual([7]);
  });

  it("normalizes labels, assignees, and metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => okJson([issueItem(7)])),
    );

    const [issue] = await listGithubIssues("token", "o", "r");
    expect(issue.labels).toEqual(["bug", "auth"]);
    expect(issue.assignees).toEqual(["bob"]);
    expect(issue.authorLogin).toBe("alice");
    expect(issue.authorGithubId).toBe(11);
    expect(issue.commentsCount).toBe(3);
    expect(issue.htmlUrl).toBe("https://github.com/o/r/issues/7");
  });

  it("bounds pagination to maxPages", async () => {
    const full = Array.from({ length: 100 }, (_, i) => issueItem(i + 1));
    const fetchMock = vi.fn().mockImplementation(() => okJson(full));
    vi.stubGlobal("fetch", fetchMock);

    await listGithubIssues("token", "o", "r", { maxPages: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps comments with author identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        okJson([
          {
            id: 55,
            user: { login: "carol" },
            body: "Reproduced.",
            created_at: "2026-09-02T00:00:00Z",
            updated_at: "2026-09-02T01:00:00Z",
          },
        ]),
      ),
    );

    const comments = await listGithubIssueComments("token", "o", "r", 7);
    expect(comments).toEqual([
      {
        id: 55,
        authorLogin: "carol",
        body: "Reproduced.",
        createdAt: "2026-09-02T00:00:00Z",
        updatedAt: "2026-09-02T01:00:00Z",
      },
    ]);
  });

  it("retries transient failures and surfaces auth errors classified", async () => {
    const failing: Response = {
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: () => Promise.resolve({}),
    } as unknown as Response;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(failing))
      .mockImplementationOnce(() => Promise.resolve(failing))
      .mockImplementation(() => okJson([]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listGithubIssues("token", "o", "r")).resolves.toEqual([]);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("throws GithubApiError 401 without retrying auth failures", async () => {
    const unauthorized: Response = {
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: () => Promise.resolve({}),
    } as unknown as Response;
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(unauthorized));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listGithubIssues("token", "o", "r")).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles malformed label entries without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => okJson([issueItem(7, { labels: [{}, null, "ok"] })])),
    );

    const [issue] = await listGithubIssues("token", "o", "r");
    expect(issue.labels).toEqual(["ok"]);
  });
});

describe("GithubApiError classification", () => {
  it("carries status for downstream mapping", () => {
    const err = new GithubApiError(401, "rejected");
    expect(err.status).toBe(401);
    expect(err.rateLimited).toBe(false);
  });
});
