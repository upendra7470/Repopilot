import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { handleGithubIdentity } from "../github-auth.service.js";
import { syncPullRequests } from "../pr-sync.service.js";
import {
  createRepository,
  linkUserRepository,
} from "../repository.service.js";
import { getDb } from "../../db/index.js";
import { prCommits, prFiles, pullRequests } from "../../db/schema.js";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    prs: [] as Array<Record<string, unknown>>,
    detail: null as Record<string, unknown> | null,
    commits: [] as Array<Record<string, unknown>>,
    files: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../github-provider.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../github-provider.js")>();
  return {
    ...original,
    listGithubPullRequests: vi.fn(async () => mockState.prs),
    fetchGithubPullRequest: vi.fn(async () => {
      if (!mockState.detail) throw new original.GithubApiError(404, "missing");
      return mockState.detail;
    }),
    listGithubPullCommits: vi.fn(async () => mockState.commits),
    listGithubPullFiles: vi.fn(async () => mockState.files),
  };
});

function setupEnv(): void {
  process.env.DATABASE_URL = "postgresql://localhost:5432/repopilot_test";
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.AUTH_SECRET = "test-only-auth-secret-at-least-32-chars!!";
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function prListItem(number: number) {
  return {
    id: 1000 + number,
    number,
    title: `PR ${number}`,
    body: null,
    state: number === 1 ? "open" : "closed",
    draft: false,
    merged: number !== 1,
    authorLogin: "alice",
    authorGithubId: 1,
    sourceBranch: `feature-${number}`,
    targetBranch: "main",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    mergeCommitSha: null,
    htmlUrl: `https://github.com/o/r/pull/${number}`,
    additions: null,
    deletions: null,
    changedFiles: null,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-02T10:00:00Z",
    closedAt: null,
    mergedAt: null,
  };
}

function prDetail(number: number) {
  return {
    ...prListItem(number),
    additions: 183,
    deletions: 72,
    changedFiles: 4,
    merged: false,
    state: "open",
  };
}

describe("PR sync service", () => {
  beforeEach(() => {
    setupEnv();
    mockState.prs = [prListItem(1), prListItem(2)];
    mockState.detail = prDetail(1);
    mockState.commits = [];
    mockState.files = [
      {
        path: "src/a.ts",
        previousPath: null,
        sha: "c".repeat(40),
        status: "modified",
        additions: 10,
        deletions: 2,
        changes: 12,
      },
    ];
  });

  async function connectedRepo() {
    const suffix = uniqueSuffix();
    const login = await handleGithubIdentity(
      {
        githubId: `gh-pr-${suffix}`,
        login: `pr-${suffix}`,
        name: null,
        email: null,
        avatarUrl: null,
      },
      { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
    );
    const record = await createRepository({
      githubId: `gh-pr-repo-${suffix}`,
      owner: "o",
      name: `r-${suffix}`,
      fullName: `o/r-${suffix}`,
    });
    await linkUserRepository(login.user.id, record.id, "owner");
    return record;
  }

  it("persists PRs with stats, files, and idempotent reruns", async () => {
    const repo = await connectedRepo();
    const db = getDb();

    // Detail mock serves whichever PR number is requested.
    const { fetchGithubPullRequest } = await import("../github-provider.js");
    vi.mocked(fetchGithubPullRequest).mockImplementation(async (
      _t: string,
      _o: string,
      _n: string,
      prNumber: number,
    ) => prDetail(prNumber) as never);

    const first = await syncPullRequests(repo.id, "token", "o", "r");
    expect(first.prCount).toBe(2);

    const rows = await db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.repositoryId, repo.id));
    expect(rows).toHaveLength(2);
    const pr1 = rows.find((r) => r.number === 1)!;
    expect(pr1).toMatchObject({
      githubId: "1001",
      state: "open",
      additions: 183,
      changedFilesCount: 4,
    });

    const storedFiles = await db
      .select()
      .from(prFiles)
      .where(eq(prFiles.repositoryId, repo.id));
    expect(storedFiles).toHaveLength(2);
    expect(storedFiles[0]).toMatchObject({ path: "src/a.ts", status: "modified" });
    expect(storedFiles[0]).not.toHaveProperty("patch");

    // Rerun: same rows, no duplicates.
    await syncPullRequests(repo.id, "token", "o", "r");
    const rerun = await db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(eq(pullRequests.repositoryId, repo.id));
    expect(rerun).toHaveLength(2);

    // Commit links reuse existing rows without duplicating commits.
    const links = await db
      .select()
      .from(prCommits)
      .where(eq(prCommits.pullRequestId, pr1.id));
    expect(links).toHaveLength(0);
  });

  it("links PR commits to existing commit rows", async () => {
    const repo = await connectedRepo();
    const db = getDb();
    const { fetchGithubPullRequest } = await import("../github-provider.js");
    vi.mocked(fetchGithubPullRequest).mockImplementation(async () => prDetail(1) as never);

    const sha = "d".repeat(40);
    await db.insert(
      (await import("../../db/schema.js")).commits,
    ).values({ repositoryId: repo.id, sha, message: "base" });
    mockState.commits = [
      {
        sha,
        message: "base",
        author: { name: "A", email: "a@x", login: "alice", githubId: 1, avatarUrl: null, date: "2026-09-01T10:00:00Z" },
        committer: { name: "A", email: "a@x", login: "alice", githubId: 1, avatarUrl: null, date: "2026-09-01T10:00:00Z" },
        url: null,
        parents: [],
      },
    ];

    await syncPullRequests(repo.id, "token", "o", "r");

    const pr = (
      await db
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.repositoryId, repo.id))
    ).find((r) => r.number === 1)!;
    const links = await db
      .select()
      .from(prCommits)
      .where(eq(prCommits.pullRequestId, pr.id));
    expect(links).toHaveLength(1);

    // Commit table itself untouched in size (reused, not duplicated).
    const { commits } = await import("../../db/schema.js");
    const all = await db
      .select({ id: commits.id })
      .from(commits)
      .where(eq(commits.repositoryId, repo.id));
    expect(all).toHaveLength(1);
  });

  it("caps ingestion at the documented bound", async () => {
    const repo = await connectedRepo();
    mockState.prs = Array.from({ length: 80 }, (_, i) => prListItem(i + 1));

    const { prCount } = await syncPullRequests(repo.id, "token", "o", "r");
    expect(prCount).toBeLessThanOrEqual(50);

    const db = getDb();
    const rows = await db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(eq(pullRequests.repositoryId, repo.id));
    expect(rows.length).toBeLessThanOrEqual(50);
  });
});
