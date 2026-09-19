import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleGithubIdentity } from "../github-auth.service.js";
import { startRepositorySync } from "../repo-sync.service.js";
import {
  areaOfPath,
  getContributorActivity,
  getContributorSummaries,
  getContributorsForFile,
  getCommitsTouchingFile,
  getFileHistory,
  getFilesChangedByContributor,
  getFrequentlyChangedFiles,
  getMemoryOverview,
  getRecentActivity,
  listRepositoryFiles,
  searchMemory,
} from "../memory.service.js";
import {
  createRepository,
  linkUserRepository,
} from "../repository.service.js";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    commits: [] as Array<Record<string, unknown>>,
    treeEntries: [] as Array<Record<string, unknown>>,
    commitFiles: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../github-provider.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../github-provider.js")>();
  return {
    ...original,
    fetchGithubRepoMetadata: vi.fn(async () => ({
      id: 8001,
      owner: "o",
      name: "r",
      fullName: "o/r",
      description: null,
      isPrivate: false,
      defaultBranch: "main",
      htmlUrl: "https://github.com/o/r",
      archived: false,
      fork: false,
      updatedAt: null,
    })),
    listGithubBranches: vi.fn(async () => [
      { name: "main", sha: "a".repeat(40), isProtected: true },
    ]),
    listGithubCommits: vi.fn(async () => mockState.commits),
    fetchGithubTree: vi.fn(async () => ({
      truncated: false,
      entries: mockState.treeEntries,
    })),
    fetchGithubCommitFiles: vi.fn(async () => mockState.commitFiles),
    listGithubPullRequests: vi.fn(async () => []),
    fetchGithubPullRequest: vi.fn(async () => {
      throw new original.GithubApiError(404, "missing");
    }),
    listGithubPullCommits: vi.fn(async () => []),
    listGithubPullFiles: vi.fn(async () => []),
    listGithubIssues: vi.fn(async () => []),
    listGithubIssueComments: vi.fn(async () => []),
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

function person(login: string, githubId: number) {
  return {
    name: login,
    email: `${login}@example.com`,
    login,
    githubId,
    avatarUrl: null,
    date: "2026-09-01T10:00:00Z",
  };
}

describe("Engineering memory service", () => {
  beforeEach(() => {
    setupEnv();
    mockState.commits = [
      {
        sha: "a".repeat(40),
        message: "fix payments retry",
        author: person("alice", 1),
        committer: person("alice", 1),
        url: null,
        parents: [],
      },
      {
        sha: "b".repeat(40),
        message: "add webhook validation",
        author: person("bob", 2),
        committer: person("bob", 2),
        url: null,
        parents: ["a".repeat(40)],
      },
      {
        sha: "c".repeat(40),
        message: "payments follow-up",
        author: { ...person("alice", 1), date: "2026-09-02T10:00:00Z" },
        committer: { ...person("alice", 1), date: "2026-09-02T10:00:00Z" },
        url: null,
        parents: ["b".repeat(40)],
      },
    ];
    mockState.treeEntries = [
      { path: "src/payments/service.ts", sha: "s1", type: "blob", size: 100, mode: "100644" },
      { path: "src/webhooks/handler.ts", sha: "s2", type: "blob", size: 50, mode: "100644" },
      { path: "README.md", sha: "s3", type: "blob", size: 10, mode: "100644" },
    ];
    mockState.commitFiles = [
      { path: "src/payments/service.ts", sha: "s1", status: "modified", additions: 5, deletions: 1 },
    ];
  });

  async function syncedRepo() {
    const suffix = uniqueSuffix();
    const login = await handleGithubIdentity(
      {
        githubId: `gh-mem-${suffix}`,
        login: `mem-${suffix}`,
        name: null,
        email: null,
        avatarUrl: null,
      },
      { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
    );
    const record = await createRepository({
      githubId: `gh-mem-repo-${suffix}`,
      owner: "o",
      name: `r-${suffix}`,
      fullName: `o/r-${suffix}`,
    });
    await linkUserRepository(login.user.id, record.id, "owner");
    await startRepositorySync(login.user.id, record.id);
    return { userId: login.user.id, repositoryId: record.id };
  }

  it("builds an overview purely from synced records", async () => {
    const { repositoryId } = await syncedRepo();

    const overview = await getMemoryOverview(repositoryId);

    expect(overview.counts).toMatchObject({
      branches: 1,
      commits: 3,
      files: 3,
      contributors: 2,
    });
    expect(overview.recentActivity).toHaveLength(3);
    expect(overview.recentActivity[0].title).toBe("payments follow-up");
    expect(overview.frequentlyChangedFiles[0]).toMatchObject({
      path: "src/payments/service.ts",
      changes: 3,
    });
    expect(overview.activeContributors.map((c) => c.login)).toContain("alice");
    const areas = new Map(overview.areas.map((a) => [a.area, a]));
    expect(areas.get("src")?.files).toBe(2);
    expect(areas.get("(root)")?.files).toBe(1);
  });

  it("traces file history with contributors and latest change", async () => {
    const { repositoryId } = await syncedRepo();
    const target = (
      await listRepositoryFiles(repositoryId)
    ).find((f) => f.path === "src/payments/service.ts");
    expect(target).toBeDefined();

    const history = await getFileHistory(repositoryId, target!.id);

    expect(history?.changeCount).toBe(3);
    expect(history?.contributors).toEqual([
      { login: "alice", changes: 2 },
      { login: "bob", changes: 1 },
    ]);
    expect(history?.latestChange?.sha).toBe("c".repeat(40));
    expect(history?.history).toHaveLength(3);

    expect(await getFileHistory(repositoryId, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("derives factual contributor activity without judgments", async () => {
    const { repositoryId } = await syncedRepo();
    const summaries = await getContributorSummaries(repositoryId);
    const alice = summaries.find((s) => s.login === "alice");
    expect(alice?.commitCount).toBe(2);

    const activity = await getContributorActivity(repositoryId, alice!.id);
    expect(activity).toMatchObject({ commitCount: 2, filesTouched: 1 });
    expect(activity?.frequentAreas).toEqual([{ area: "src", changes: 2 }]);
    expect(activity?.recentCommits).toHaveLength(2);
    expect(activity).not.toHaveProperty("score");
    expect(activity).not.toHaveProperty("rank");

    expect(
      await getContributorActivity(repositoryId, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("answers focused relationship queries", async () => {
    const { repositoryId } = await syncedRepo();
    const summaries = await getContributorSummaries(repositoryId);
    const alice = summaries.find((s) => s.login === "alice")!;

    expect(await getCommitsTouchingFile(repositoryId, "src/payments/service.ts")).toHaveLength(3);
    expect(await getContributorsForFile(repositoryId, "src/payments/service.ts")).toEqual([
      { login: "alice", changes: 2 },
      { login: "bob", changes: 1 },
    ]);
    const aliceFiles = await getFilesChangedByContributor(repositoryId, alice.id);
    expect(aliceFiles).toEqual([{ path: "src/payments/service.ts", changes: 2 }]);
    expect(
      await getFilesChangedByContributor(repositoryId, "00000000-0000-0000-0000-000000000000"),
    ).toEqual([]);
  });

  it("searches files, commits, and contributors deterministically", async () => {
    const { repositoryId } = await syncedRepo();

    const payments = await searchMemory(repositoryId, "payment");
    expect(payments.files.map((f) => f.path)).toEqual(["src/payments/service.ts"]);
    expect(payments.commits).toHaveLength(2);
    expect(payments.contributors).toHaveLength(0);

    const who = await searchMemory(repositoryId, "bob");
    expect(who.contributors.map((c) => c.login)).toEqual(["bob"]);

    const none = await searchMemory(repositoryId, "zzz-no-match");
    expect(none).toEqual({ files: [], commits: [], contributors: [] });
  });

  it("returns empty-but-valid shapes when nothing synced yet", async () => {
    const suffix = uniqueSuffix();
    const login = await handleGithubIdentity(
      {
        githubId: `gh-empty-${suffix}`,
        login: `empty-${suffix}`,
        name: null,
        email: null,
        avatarUrl: null,
      },
      { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
    );
    const record = await createRepository({
      githubId: `gh-empty-repo-${suffix}`,
      owner: "o",
      name: `empty-${suffix}`,
      fullName: `o/empty-${suffix}`,
    });
    await linkUserRepository(login.user.id, record.id, "owner");

    const overview = await getMemoryOverview(record.id);
    expect(overview.counts).toEqual({ branches: 0, commits: 0, files: 0, contributors: 0 });
    expect(overview.recentActivity).toEqual([]);
    expect(await getRecentActivity(record.id)).toEqual([]);
    expect(await getFrequentlyChangedFiles(record.id)).toEqual([]);
  });

  it("groups paths into deterministic areas", () => {
    expect(areaOfPath("src/payments/service.ts")).toBe("src");
    expect(areaOfPath("README.md")).toBe("(root)");
    expect(areaOfPath("a/b/c/d.ts")).toBe("a");
  });
});
