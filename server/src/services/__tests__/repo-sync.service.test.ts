import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { handleGithubIdentity } from "../github-auth.service.js";
import {
  startRepositorySync,
  getLatestSyncRun,
  getRepositorySyncCounts,
  SyncError,
  STALE_RUN_MS,
} from "../repo-sync.service.js";
import { GithubApiError } from "../github-provider.js";
import { setGithubCredential } from "../credential-store.js";
import {
  createRepository,
  linkUserRepository,
} from "../repository.service.js";
import { getDb } from "../../db/index.js";
import {
  branches,
  commits,
  commitFiles,
  contributors,
  files,
  repositories,
  syncRuns,
} from "../../db/schema.js";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    meta: null as Record<string, unknown> | null,
    branchList: [] as Array<Record<string, unknown>>,
    commitList: [] as Array<Record<string, unknown>>,
    commitCalls: [] as Array<unknown>,
    tree: { truncated: false, entries: [] as Array<Record<string, unknown>> },
    commitFiles: [] as Array<Record<string, unknown>>,
    failTree: false,
    authError: null as GithubApiError | null,
  },
}));

vi.mock("../github-provider.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../github-provider.js")>();
  return {
    ...original,
    fetchGithubRepoMetadata: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      return (
        mockState.meta ?? {
          id: 1,
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
        }
      );
    }),
    listGithubBranches: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      return mockState.branchList;
    }),
    listGithubCommits: vi.fn(async (_t: string, _o: string, _n: string, opts: unknown) => {
      if (mockState.authError) throw mockState.authError;
      mockState.commitCalls.push(opts);
      return mockState.commitList;
    }),
    fetchGithubTree: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      if (mockState.failTree) throw new original.GithubApiError(500, "boom");
      return mockState.tree;
    }),
    fetchGithubCommitFiles: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      return mockState.commitFiles;
    }),
    listGithubPullRequests: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      return [];
    }),
    fetchGithubPullRequest: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      throw new original.GithubApiError(404, "missing");
    }),
    listGithubPullCommits: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      return [];
    }),
    listGithubPullFiles: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      return [];
    }),
    listGithubIssues: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      return [];
    }),
    listGithubIssueComments: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      return [];
    }),
    listGithubWorkflows: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      return [];
    }),
    listGithubWorkflowRuns: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      return [];
    }),
    listGithubRunJobs: vi.fn(async () => {
      if (mockState.authError) throw mockState.authError;
      return [];
    }),
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

const SHA = (ch: string) => ch.repeat(40);

function ghCommit(sha: string, login: string | null, githubId: number | null) {
  return {
    sha,
    message: `commit ${sha.slice(0, 6)}`,
    author: {
      name: "Author",
      email: "a@example.com",
      login,
      githubId,
      avatarUrl: null,
      date: "2026-09-01T10:00:00Z",
    },
    committer: {
      name: "Author",
      email: "a@example.com",
      login,
      githubId,
      avatarUrl: null,
      date: "2026-09-01T10:00:00Z",
    },
    url: `https://github.com/o/r/commit/${sha}`,
    parents: [],
  };
}

async function loginFreshUser() {
  const suffix = uniqueSuffix();
  return handleGithubIdentity(
    {
      githubId: `gh-sync-${suffix}`,
      login: `sync-${suffix}`,
      name: null,
      email: null,
      avatarUrl: null,
    },
    { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
  );
}

async function connectedRepo(userId: string, isPrivate = false) {
  const suffix = uniqueSuffix();
  const record = await createRepository({
    githubId: `gh-repo-${suffix}`,
    owner: "o",
    name: `r-${suffix}`,
    fullName: `o/r-${suffix}`,
    isPrivate,
  });
  await linkUserRepository(userId, record.id, "owner");
  return record;
}

async function tableCounts(repositoryId: string) {
  const db = getDb();
  const countIn = async (table: typeof branches) =>
    (await db.select({ n: count() }).from(table).where(eq(table.repositoryId, repositoryId)))[0].n;
  return {
    branches: await countIn(branches),
    commits: await db
      .select({ n: count() })
      .from(commits)
      .where(eq(commits.repositoryId, repositoryId))
      .then((r) => r[0].n),
    files: await db
      .select({ n: count() })
      .from(files)
      .where(eq(files.repositoryId, repositoryId))
      .then((r) => r[0].n),
    contributors: await db
      .select({ n: count() })
      .from(contributors)
      .where(eq(contributors.repositoryId, repositoryId))
      .then((r) => r[0].n),
    commitFiles: await db
      .select({ n: count() })
      .from(commitFiles)
      .where(eq(commitFiles.repositoryId, repositoryId))
      .then((r) => r[0].n),
  };
}

describe("Repository sync service", () => {
  beforeEach(() => {
    setupEnv();
    mockState.meta = null;
    mockState.branchList = [
      { name: "main", sha: SHA("a"), isProtected: true },
      { name: "dev", sha: SHA("b"), isProtected: false },
    ];
    mockState.commitList = [
      ghCommit(SHA("c"), "alice", 101),
      ghCommit(SHA("d"), "bob", 102),
    ];
    mockState.commitCalls = [];
    mockState.tree = {
      truncated: false,
      entries: [
        { path: "README.md", sha: SHA("e"), type: "blob", size: 42, mode: "100644" },
        { path: "src", sha: SHA("f"), type: "tree", size: null, mode: "040000" },
        { path: "vendor", sha: SHA("0"), type: "tree", size: null, mode: "040000" },
      ],
    };
    mockState.commitFiles = [
      { path: "README.md", sha: SHA("e"), status: "modified", additions: 3, deletions: 1 },
    ];
    mockState.failTree = false;
    mockState.authError = null;
  });

  it("syncs metadata, branches, commits, files, contributors, and relationships", async () => {
    const login = await loginFreshUser();
    const repo = await connectedRepo(login.user.id);

    const summary = await startRepositorySync(login.user.id, repo.id);

    expect(summary.status).toBe("succeeded");
    expect(summary.branchCount).toBe(2);
    expect(summary.commitCount).toBe(2);
    // Only the blob is persisted: directory entries ("src", "vendor")
    // must never inflate file counts.
    expect(summary.fileCount).toBe(1);
    expect(summary.contributorCount).toBe(2);

    const counts = await tableCounts(repo.id);
    expect(counts).toMatchObject({
      branches: 2,
      commits: 2,
      files: 1,
      contributors: 2,
      commitFiles: 2,
    });

    // Branch state, contributor identity, commit linkage.
    const db = getDb();
    const main = await db
      .select()
      .from(branches)
      .where(and(eq(branches.repositoryId, repo.id), eq(branches.name, "main")));
    expect(main[0]).toMatchObject({ sha: SHA("a"), protected: true });

    const alice = await db
      .select()
      .from(contributors)
      .where(and(eq(contributors.repositoryId, repo.id), eq(contributors.login, "alice")));
    expect(alice).toHaveLength(1);
    expect(alice[0].githubId).toBe("101");

    const commitRows = await db
      .select()
      .from(commits)
      .where(and(eq(commits.repositoryId, repo.id), eq(commits.sha, SHA("c"))));
    expect(commitRows[0].contributorId).toBe(alice[0].id);
    expect(commitRows[0].parentShas).toEqual([]);

    // Run record + repository sync state.
    const run = await getLatestSyncRun(repo.id);
    expect(run?.status).toBe("succeeded");
    expect(run?.finishedAt).not.toBeNull();
    const summaryCounts = await getRepositorySyncCounts(repo.id);
    expect(summaryCounts).toMatchObject({
      branches: 2,
      commits: 2,
      files: 1,
      contributors: 2,
    });

    // No directory rows persisted at all.
    const storedFiles = await db
      .select({ path: files.path, type: files.type })
      .from(files)
      .where(eq(files.repositoryId, repo.id));
    expect(storedFiles).toEqual([{ path: "README.md", type: "blob" }]);

    // The database itself rejects non-blob rows (files_blob_only CHECK;
    // Drizzle surfaces the PostgreSQL code on `cause`).
    const rejected = await db
      .insert(files)
      .values({ repositoryId: repo.id, ref: "main", path: "adir", type: "tree" })
      .catch((e: unknown) => e);
    expect(
      (rejected as { cause?: { code?: string } })?.cause?.code,
    ).toBe("23514");
  });

  it("is idempotent across repeated syncs", async () => {
    const login = await loginFreshUser();
    const repo = await connectedRepo(login.user.id);

    await startRepositorySync(login.user.id, repo.id);
    const before = await tableCounts(repo.id);
    const second = await startRepositorySync(login.user.id, repo.id);
    const after = await tableCounts(repo.id);

    expect(second.status).toBe("succeeded");
    expect(after).toEqual(before);
  });

  it("is incremental: second sync passes `since` and stores only new commits", async () => {
    const login = await loginFreshUser();
    const repo = await connectedRepo(login.user.id);

    await startRepositorySync(login.user.id, repo.id);
    expect(mockState.commitCalls[0]).toMatchObject({});

    mockState.commitList = [ghCommit(SHA("9"), "alice", 101)];
    await startRepositorySync(login.user.id, repo.id);

    const lastCall = mockState.commitCalls[mockState.commitCalls.length - 1] as {
      since?: string;
    };
    expect(lastCall.since).toBe("2026-09-01T10:00:00.000Z");

    const counts = await tableCounts(repo.id);
    expect(counts.commits).toBe(3);
  });

  it("records partial failure without crashing", async () => {
    const login = await loginFreshUser();
    const repo = await connectedRepo(login.user.id);
    mockState.failTree = true;

    await expect(
      startRepositorySync(login.user.id, repo.id),
    ).rejects.toBeInstanceOf(GithubApiError);

    const run = await getLatestSyncRun(repo.id);
    expect(run?.status).toBe("failed");
    expect(run?.errorCode).toBe("GITHUB_500");

    const db = getDb();
    const repoRow = (
      await db.select().from(repositories).where(eq(repositories.id, repo.id))
    )[0];
    expect(repoRow.syncStatus).toBe("failed");

    // Earlier stages persisted before the tree failure.
    const counts = await tableCounts(repo.id);
    expect(counts.branches).toBe(2);
    expect(counts.commits).toBe(2);
  });

  it("does not retry invalid credentials and surfaces 502", async () => {
    const login = await loginFreshUser();
    const repo = await connectedRepo(login.user.id);
    mockState.authError = new GithubApiError(401, "bad credential");

    const err = await startRepositorySync(login.user.id, repo.id).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(GithubApiError);
    expect(err.status).toBe(401);

    const run = await getLatestSyncRun(repo.id);
    expect(run?.status).toBe("failed");
    expect(run?.errorCode).toBe("GITHUB_401");
  });

  it("prevents concurrent syncs for the same repository", async () => {
    const login = await loginFreshUser();
    const repo = await connectedRepo(login.user.id);
    const db = getDb();

    // Simulate a sync already running (partial unique index guard).
    await db.insert(syncRuns).values({ repositoryId: repo.id, status: "running" });

    const err = await startRepositorySync(login.user.id, repo.id).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(SyncError);
    expect(err.code).toBe("SYNC_IN_PROGRESS");
    expect(err.httpStatus).toBe(409);

    // Cleanup: mark the simulated run finished.
    await db
      .update(syncRuns)
      .set({ status: "failed", finishedAt: new Date() })
      .where(
        and(eq(syncRuns.repositoryId, repo.id), eq(syncRuns.status, "running")),
      );
  });

  it("recovers stale running runs instead of staying stuck", async () => {
    const login = await loginFreshUser();
    const repo = await connectedRepo(login.user.id);
    const db = getDb();

    await db.insert(syncRuns).values({
      repositoryId: repo.id,
      status: "running",
      startedAt: new Date(Date.now() - STALE_RUN_MS - 1000),
    });
    await db
      .update(repositories)
      .set({ syncStatus: "running" })
      .where(eq(repositories.id, repo.id));

    const summary = await startRepositorySync(login.user.id, repo.id);
    expect(summary.status).toBe("succeeded");

    const stale = await db
      .select()
      .from(syncRuns)
      .where(
        and(eq(syncRuns.repositoryId, repo.id), eq(syncRuns.errorCode, "STALE")),
      );
    expect(stale).toHaveLength(1);
  });

  it("enforces authorization and validation", async () => {
    const owner = await loginFreshUser();
    const stranger = await loginFreshUser();
    const repo = await connectedRepo(owner.user.id);

    const strangerErr = await startRepositorySync(
      stranger.user.id,
      repo.id,
    ).catch((e) => e);
    expect(strangerErr).toBeInstanceOf(SyncError);
    expect(strangerErr.httpStatus).toBe(404);

    const malformedErr = await startRepositorySync(
      owner.user.id,
      "not-a-uuid",
    ).catch((e) => e);
    expect(malformedErr).toBeInstanceOf(SyncError);
    expect(malformedErr.httpStatus).toBe(400);

    const { createUser } = await import("../user.service.js");
    const orphan = await createUser({ login: `orphan-${uniqueSuffix()}` });
    const orphanErr = await startRepositorySync(orphan.id, repo.id).catch(
      (e) => e,
    );
    // Orphan has no link to the repo → 404, before credential lookup.
    expect(orphanErr).toBeInstanceOf(SyncError);
    expect(orphanErr.httpStatus).toBe(404);
  });

  it("requires repo scope for private repositories", async () => {
    const login = await loginFreshUser();
    const repo = await connectedRepo(login.user.id, true);

    const err = await startRepositorySync(login.user.id, repo.id).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(SyncError);
    expect(err.code).toBe("PRIVATE_REPO_REQUIRES_SCOPE");
    expect(err.httpStatus).toBe(403);

    // After re-authorization with the repo scope, sync proceeds.
    await setGithubCredential(
      login.user.id,
      `gh-sync-scope-${uniqueSuffix()}`,
      "test-only-token",
      "read:user user:email repo",
    );
    mockState.meta = {
      id: 2,
      owner: "o",
      name: repo.name,
      fullName: repo.fullName,
      description: null,
      isPrivate: true,
      defaultBranch: "main",
      htmlUrl: `https://github.com/${repo.fullName}`,
      archived: false,
      fork: false,
      updatedAt: null,
    };
    const summary = await startRepositorySync(login.user.id, repo.id);
    expect(summary.status).toBe("succeeded");
  });

  it("handles anonymous commits without contributor rows", async () => {
    const login = await loginFreshUser();
    const repo = await connectedRepo(login.user.id);
    mockState.commitList = [
      {
        sha: SHA("7"),
        message: "anonymous fix",
        author: {
          name: "Mystery",
          email: "mystery@example.com",
          login: null,
          githubId: null,
          avatarUrl: null,
          date: "2026-09-02T10:00:00Z",
        },
        committer: {
          name: "Mystery",
          email: "mystery@example.com",
          login: null,
          githubId: null,
          avatarUrl: null,
          date: "2026-09-02T10:00:00Z",
        },
        url: null,
        parents: [],
      },
    ];

    await startRepositorySync(login.user.id, repo.id);

    const db = getDb();
    const rows = await db
      .select()
      .from(commits)
      .where(eq(commits.repositoryId, repo.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].authorName).toBe("Mystery");
    expect(rows[0].contributorId).toBeNull();
    const counts = await tableCounts(repo.id);
    expect(counts.contributors).toBe(0);
  });

  it("database constraints reject duplicate commits and files", async () => {
    const login = await loginFreshUser();
    const repo = await connectedRepo(login.user.id);
    const db = getDb();

    await db.insert(commits).values({ repositoryId: repo.id, sha: SHA("8") });
    const dupCommit = await db
      .insert(commits)
      .values({ repositoryId: repo.id, sha: SHA("8") })
      .catch((e: unknown) => e);
    expect((dupCommit as { cause?: { code?: string } })?.cause?.code).toBe(
      "23505",
    );

    const commitId = (
      await db
        .select({ id: commits.id })
        .from(commits)
        .where(and(eq(commits.repositoryId, repo.id), eq(commits.sha, SHA("8"))))
    )[0].id;
    await db
      .insert(commitFiles)
      .values({ commitId, repositoryId: repo.id, path: "a.ts" });
    const dupFile = await db
      .insert(commitFiles)
      .values({ commitId, repositoryId: repo.id, path: "a.ts" })
      .catch((e: unknown) => e);
    expect((dupFile as { cause?: { code?: string } })?.cause?.code).toBe(
      "23505",
    );
  });
});
