import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  computePrIntelligence,
  getPullRequest,
  listPullRequests,
} from "../pr-intelligence.service.js";
import { handleGithubIdentity } from "../github-auth.service.js";
import {
  createRepository,
  linkUserRepository,
} from "../repository.service.js";
import { getDb } from "../../db/index.js";
import { commits, commitFiles, prCommits, prFiles, pullRequests } from "../../db/schema.js";

function setupEnv(): void {
  process.env.DATABASE_URL = "postgresql://localhost:5432/repopilot_test";
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.AUTH_SECRET = "test-only-auth-secret-at-least-32-chars!!";
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const sha = (ch: string, salt = "") => `${ch.repeat(38)}${salt.padEnd(2, "0")}`.slice(0, 40);

async function setupUser() {
  const suffix = uniqueSuffix();
  return handleGithubIdentity(
    {
      githubId: `gh-pri-${suffix}`,
      login: `pri-${suffix}`,
      name: null,
      email: null,
      avatarUrl: null,
    },
    { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
  );
}

async function setupRepo(userId: string) {
  const suffix = uniqueSuffix();
  const record = await createRepository({
    githubId: `gh-pri-repo-${suffix}`,
    owner: "o",
    name: `r-${suffix}`,
    fullName: `o/r-${suffix}`,
  });
  await linkUserRepository(userId, record.id, "owner");
  return record;
}

async function addWindowCommit(
  repositoryId: string,
  seed: { sha: string; message: string; login?: string; daysAgo: number; path: string },
) {
  const db = getDb();
  const [commit] = await db
    .insert(commits)
    .values({
      repositoryId,
      sha: seed.sha,
      message: seed.message,
      authorLogin: seed.login ?? "alice",
      committedAt: daysAgo(seed.daysAgo),
    })
    .returning({ id: commits.id });
  await db.insert(commitFiles).values({
    commitId: commit.id,
    repositoryId,
    path: seed.path,
    status: "modified",
    additions: 2,
    deletions: 1,
  });
  return commit;
}

async function addPr(repositoryId: string, overrides: Record<string, unknown> = {}) {
  const db = getDb();
  const [row] = await db
    .insert(pullRequests)
    .values({
      repositoryId,
      githubId: `gh-pr-${uniqueSuffix()}`,
      number: 42,
      title: "Refactor authentication middleware",
      body: "Cleans up session handling.",
      state: "open",
      draft: false,
      merged: false,
      authorLogin: "bob",
      sourceBranch: "refactor-auth",
      targetBranch: "main",
      headSha: sha("a"),
      baseSha: sha("b"),
      htmlUrl: "https://github.com/o/r/pull/42",
      additions: 183,
      deletions: 72,
      changedFilesCount: 4,
      githubCreatedAt: daysAgo(3),
      githubUpdatedAt: daysAgo(1),
      ...overrides,
    })
    .returning();
  return row;
}

describe("Deterministic PR intelligence", () => {
  beforeEach(() => {
    setupEnv();
  });

  it("returns nulls and empty lists when nothing exists", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);

    expect(await listPullRequests(repo.id)).toEqual([]);
    expect(await getPullRequest(repo.id, 42)).toBeNull();
    expect(await computePrIntelligence(repo.id, 42)).toBeNull();
  });

  it("filters PR lists by state without leakage", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    const other = await setupRepo(login.user.id);
    await addPr(repo.id, { number: 1, state: "open" });
    await addPr(repo.id, { number: 2, state: "closed", merged: true });
    await addPr(other.id, { number: 1, state: "open" });

    expect((await listPullRequests(repo.id, "open")).map((p) => p.number)).toEqual([1]);
    expect((await listPullRequests(repo.id, "merged")).map((p) => p.number)).toEqual([2]);
    expect((await listPullRequests(repo.id, "all")).map((p) => p.number).sort()).toEqual([1, 2]);
    expect((await listPullRequests(other.id)).map((p) => p.number)).toEqual([1]);
  });

  it("computes grounded signals from persisted records", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    const pr = await addPr(repo.id, { additions: 1500, deletions: 300 });

    // Window history: hot file + corrective context on the same path.
    for (let i = 0; i < 6; i++) {
      await addWindowCommit(repo.id, {
        sha: sha("c", String(i)),
        message: i === 0 ? "fix hot path regression" : `tweak ${i}`,
        login: "alice",
        daysAgo: 4,
        path: "src/auth/session.ts",
      });
    }
    const db = getDb();
    await db.insert(prFiles).values({
      pullRequestId: pr.id,
      repositoryId: repo.id,
      path: "src/auth/session.ts",
      status: "modified",
      additions: 100,
      deletions: 20,
    });
    const commitRow = (
      await db
        .select({ id: commits.id })
        .from(commits)
        .where(eq(commits.repositoryId, repo.id))
        .limit(1)
    )[0];
    await db.insert(prCommits).values({ pullRequestId: pr.id, commitId: commitRow.id });

    const intelligence = await computePrIntelligence(repo.id, 42);
    expect(intelligence).not.toBeNull();

    const types = intelligence!.signals.map((s) => s.type);
    expect(types).toContain("large_change_surface");
    expect(types).toContain("hot_files_touched");
    expect(types).toContain("corrective_context");
    expect(types).toContain("risk_overlap");

    // Risk overlap references the real hot-file finding.
    expect(
      intelligence!.riskFindings.some((f) => f.type === "hot_file"),
    ).toBe(true);

    // Hot-file evidence carries real counts.
    const hotFiles = intelligence!.files.filter((f) => f.hot);
    expect(hotFiles.map((f) => f.path)).toContain("src/auth/session.ts");

    // Neutral language only.
    const text = JSON.stringify(intelligence);
    expect(text).not.toMatch(/bad|terrible|best|worst|score|productiv/i);

    // Deterministic reruns.
    const again = await computePrIntelligence(repo.id, 42);
    expect(again).toEqual(intelligence);
  });

  it("flags stale open PRs and drafts factually", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    await addPr(repo.id, {
      additions: 10,
      deletions: 2,
      githubCreatedAt: daysAgo(45),
    });

    const intelligence = await computePrIntelligence(repo.id, 42);
    const types = intelligence!.signals.map((s) => s.type);
    expect(types).toContain("stale_open_pr");
    expect(types).not.toContain("large_change_surface");
  });

  it("notes authors absent from recent file history", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    await addPr(repo.id, { additions: 10, deletions: 2 });
    await addWindowCommit(repo.id, {
      sha: sha("d"),
      message: "touch",
      login: "alice",
      daysAgo: 2,
      path: "src/other.ts",
    });
    const db = getDb();
    const pr = (await getPullRequest(repo.id, 42))!;
    await db.insert(prFiles).values({
      pullRequestId: pr.id,
      repositoryId: repo.id,
      path: "src/other.ts",
      status: "modified",
    });
    // Link a commit authored by someone else so comparison is meaningful.
    const linked = await db
      .select({ id: commits.id })
      .from(commits)
      .where(eq(commits.repositoryId, repo.id))
      .limit(1);
    await db
      .insert(prCommits)
      .values({ pullRequestId: pr.id, commitId: linked[0].id });

    const intelligence = await computePrIntelligence(repo.id, 42);
    // PR author bob never touched src/other.ts in the window.
    expect(intelligence!.signals.map((s) => s.type)).toContain(
      "author_not_in_history",
    );
  });
});
