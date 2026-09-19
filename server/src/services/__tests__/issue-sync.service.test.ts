import { describe, it, expect, vi, beforeEach } from "vitest";
import { count, eq } from "drizzle-orm";
import { handleGithubIdentity } from "../github-auth.service.js";
import { syncIssues } from "../issue-sync.service.js";
import {
  createRepository,
  linkUserRepository,
} from "../repository.service.js";
import { getDb } from "../../db/index.js";
import {
  commits,
  issueCommitLinks,
  issueComments,
  issuePrLinks,
  issues,
  pullRequests,
} from "../../db/schema.js";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    issues: [] as Array<Record<string, unknown>>,
    commentsByNumber: {} as Record<number, Array<Record<string, unknown>>>,
  },
}));

vi.mock("../github-provider.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../github-provider.js")>();
  return {
    ...original,
    listGithubIssues: vi.fn(async () => mockState.issues),
    listGithubIssueComments: vi.fn(
      async (_t: string, _o: string, _n: string, number: number) =>
        mockState.commentsByNumber[number] ?? [],
    ),
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

function ghIssue(number: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 5000 + number,
    number,
    title: `Issue ${number}`,
    body: `Body for ${number}.`,
    state: "open",
    stateReason: null,
    authorLogin: "alice",
    authorGithubId: 11,
    authorAssociation: "CONTRIBUTOR",
    htmlUrl: `https://github.com/o/r/issues/${number}`,
    locked: false,
    commentsCount: 0,
    labels: ["bug"],
    milestoneNumber: null,
    milestoneTitle: null,
    milestoneState: null,
    assignees: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    closedAt: null,
    ...overrides,
  };
}

function ghComment(id: number, body: string) {
  return {
    id,
    authorLogin: "bob",
    body,
    createdAt: "2026-09-02T00:00:00Z",
    updatedAt: "2026-09-02T00:00:00Z",
  };
}

async function setupRepo() {
  const suffix = uniqueSuffix();
  const login = await handleGithubIdentity(
    {
      githubId: `gh-is-${suffix}`,
      login: `is-${suffix}`,
      name: null,
      email: null,
      avatarUrl: null,
    },
    { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
  );
  const record = await createRepository({
    githubId: `gh-is-repo-${suffix}`,
    owner: "o",
    name: `r-${suffix}`,
    fullName: `o/r-${suffix}`,
  });
  await linkUserRepository(login.user.id, record.id, "owner");
  return record;
}

async function countRows(table: typeof issues, repositoryId: string) {
  const db = getDb();
  return (
    await db
      .select({ n: count() })
      .from(table)
      .where(eq(table.repositoryId, repositoryId))
  )[0].n;
}

describe("Issue sync", () => {
  beforeEach(() => {
    setupEnv();
    mockState.issues = [];
    mockState.commentsByNumber = {};
  });

  it("ingests issues idempotently without duplicates", async () => {
    const repo = await setupRepo();
    mockState.issues = [ghIssue(42), ghIssue(43, { state: "closed" })];

    const first = await syncIssues(repo.id, "token", "o", "r");
    expect(first.issueCount).toBe(2);

    const second = await syncIssues(repo.id, "token", "o", "r");
    expect(second.issueCount).toBe(2);
    expect(await countRows(issues, repo.id)).toBe(2);
  });

  it("updates changed metadata on re-sync", async () => {
    const repo = await setupRepo();
    mockState.issues = [ghIssue(42, { title: "Before" })];
    await syncIssues(repo.id, "token", "o", "r");

    mockState.issues = [ghIssue(42, { title: "After", state: "closed" })];
    await syncIssues(repo.id, "token", "o", "r");

    const db = getDb();
    const rows = await db
      .select()
      .from(issues)
      .where(eq(issues.repositoryId, repo.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("After");
    expect(rows[0].state).toBe("closed");
  });

  it("keeps only the newest bounded comments and prunes the rest", async () => {
    const repo = await setupRepo();
    mockState.issues = [ghIssue(42, { commentsCount: 25 })];
    mockState.commentsByNumber = {
      42: Array.from({ length: 25 }, (_, i) => ghComment(i + 1, `c${i + 1}`)),
    };

    const result = await syncIssues(repo.id, "token", "o", "r");
    expect(result.commentCount).toBe(20);

    const db = getDb();
    const stored = await db
      .select()
      .from(issueComments)
      .where(eq(issueComments.repositoryId, repo.id));
    expect(stored).toHaveLength(20);
    // Newest tail retained (ids 6..25).
    expect(stored.map((c) => c.githubId).sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 6)).sort(),
    );

    // Fewer comments upstream prunes stale rows.
    mockState.commentsByNumber = {
      42: Array.from({ length: 3 }, (_, i) => ghComment(23 + i, `c${23 + i}`)),
    };
    await syncIssues(repo.id, "token", "o", "r");
    const pruned = await db
      .select()
      .from(issueComments)
      .where(eq(issueComments.repositoryId, repo.id));
    expect(pruned.map((c) => c.githubId).sort()).toEqual(["23", "24", "25"]);
  });

  it("links PRs via closing keywords and plain references with evidence", async () => {
    const repo = await setupRepo();
    const db = getDb();
    await db.insert(pullRequests).values({
      repositoryId: repo.id,
      githubId: "gh-pr-219",
      number: 219,
      title: "Repair loop",
      body: "Fixes #42 and also refs #43.",
      state: "closed",
      merged: true,
    });
    await db.insert(pullRequests).values({
      repositoryId: repo.id,
      githubId: "gh-pr-220",
      number: 220,
      title: "Unrelated",
      body: "Similar title to Issue 44 but no reference.",
      state: "open",
    });
    mockState.issues = [ghIssue(42), ghIssue(43), ghIssue(44)];

    const result = await syncIssues(repo.id, "token", "o", "r");
    expect(result.prLinkCount).toBe(2);

    const links = await db
      .select()
      .from(issuePrLinks)
      .where(eq(issuePrLinks.repositoryId, repo.id));
    const relations = links
      .map((l) => `${l.relation}:${l.evidence}`)
      .sort();
    expect(relations).toEqual([
      "closed_by:pr-body:219:closes #42",
      "referenced_by:pr-body:219:refs #43",
    ]);
    // Title similarity alone creates no link for issue 44.
    expect(links.some((l) => l.evidence?.includes("#44"))).toBe(false);
  });

  it("links commits via explicit references only", async () => {
    const repo = await setupRepo();
    const db = getDb();
    await db.insert(commits).values({
      repositoryId: repo.id,
      sha: SHA("a"),
      message: "fix auth loop (#42)",
      authorLogin: "bob",
    });
    await db.insert(commits).values({
      repositoryId: repo.id,
      sha: SHA("b"),
      message: "session work with similar words to issue 43 title",
      authorLogin: "bob",
    });
    mockState.issues = [ghIssue(42), ghIssue(43)];

    const result = await syncIssues(repo.id, "token", "o", "r");
    expect(result.commitLinkCount).toBe(1);

    const links = await db
      .select()
      .from(issueCommitLinks)
      .where(eq(issueCommitLinks.repositoryId, repo.id));
    expect(links).toHaveLength(1);
    expect(links[0].evidence).toContain("#42");
  });

  it("handles repositories with no issues", async () => {
    const repo = await setupRepo();
    mockState.issues = [];
    const result = await syncIssues(repo.id, "token", "o", "r");
    expect(result).toEqual({
      issueCount: 0,
      commentCount: 0,
      prLinkCount: 0,
      commitLinkCount: 0,
    });
    expect(await countRows(issues, repo.id)).toBe(0);
  });
});
