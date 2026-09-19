import { describe, it, expect, beforeEach } from "vitest";
import {
  computeIssueIntelligence,
  deriveIssueSignals,
  getIssue,
  listIssues,
} from "../issue-intelligence.service.js";
import { handleGithubIdentity } from "../github-auth.service.js";
import {
  createRepository,
  linkUserRepository,
} from "../repository.service.js";
import { getDb } from "../../db/index.js";
import {
  commits,
  commitFiles,
  issueCommitLinks,
  issueComments,
  issuePrLinks,
  issues,
  pullRequests,
} from "../../db/schema.js";

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
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
const sha = (ch: string, salt = "") => `${ch.repeat(38)}${salt.padEnd(2, "0")}`.slice(0, 40);

async function setupUser() {
  const suffix = uniqueSuffix();
  return handleGithubIdentity(
    {
      githubId: `gh-ii-${suffix}`,
      login: `ii-${suffix}`,
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
    githubId: `gh-ii-repo-${suffix}`,
    owner: "o",
    name: `r-${suffix}`,
    fullName: `o/r-${suffix}`,
  });
  await linkUserRepository(userId, record.id, "owner");
  return record;
}

async function addIssue(
  repositoryId: string,
  overrides: Record<string, unknown> = {},
) {
  const db = getDb();
  const suffix = uniqueSuffix();
  const [row] = await db
    .insert(issues)
    .values({
      repositoryId,
      githubId: `gh-issue-${suffix}`,
      number: 184,
      title: "Fix session refresh loop",
      body: "Loops on expiry.",
      state: "open",
      authorLogin: "alice",
      commentsCount: 1,
      labels: ["bug"],
      assignees: [],
      githubCreatedAt: daysAgo(45),
      githubUpdatedAt: hoursAgo(2),
      ...overrides,
    })
    .returning();
  return row;
}

async function addCommit(
  repositoryId: string,
  seed: { sha: string; message: string; path: string; daysAgo: number; login?: string },
) {
  const db = getDb();
  const [commit] = await db
    .insert(commits)
    .values({
      repositoryId,
      sha: seed.sha,
      message: seed.message,
      authorLogin: seed.login ?? "bob",
      committedAt: daysAgo(seed.daysAgo),
    })
    .returning({ id: commits.id });
  await db.insert(commitFiles).values({
    commitId: commit.id,
    repositoryId,
    path: seed.path,
    status: "modified",
    additions: 5,
    deletions: 2,
  });
  return commit;
}

describe("Deterministic issue intelligence", () => {
  beforeEach(() => {
    setupEnv();
  });

  it("returns nulls and empty lists when nothing exists", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);

    expect((await listIssues(repo.id)).data).toEqual([]);
    expect(await getIssue(repo.id, 184)).toBeNull();
    expect(await computeIssueIntelligence(repo.id, 184)).toBeNull();
  });

  it("detects stale open issues but not stale closed ones", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    await addIssue(repo.id, { number: 1 });
    await addIssue(repo.id, {
      number: 2,
      state: "closed",
      githubCreatedAt: daysAgo(90),
      githubUpdatedAt: daysAgo(80),
    });

    const open = await computeIssueIntelligence(repo.id, 1);
    expect(open?.signals.map((s) => s.type)).toContain("stale_open");

    const closed = await computeIssueIntelligence(repo.id, 2);
    expect(closed?.signals.map((s) => s.type)).not.toContain("stale_open");
  });

  it("distinguishes old-inactive from old-but-active issues", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    await addIssue(repo.id, {
      number: 1,
      githubCreatedAt: daysAgo(60),
      githubUpdatedAt: daysAgo(40),
    });
    await addIssue(repo.id, {
      number: 2,
      githubCreatedAt: daysAgo(60),
      githubUpdatedAt: hoursAgo(3),
    });

    const quiet = await computeIssueIntelligence(repo.id, 1);
    expect(quiet?.signals.map((s) => s.type)).toContain("inactive");

    const active = await computeIssueIntelligence(repo.id, 2);
    const types = active?.signals.map((s) => s.type) ?? [];
    expect(types).toContain("stale_open");
    expect(types).toContain("recently_active");
    expect(types).not.toContain("inactive");
  });

  it("flags high discussion by absolute volume", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    await addIssue(repo.id, { number: 1, commentsCount: 12 });
    await addIssue(repo.id, { number: 2, commentsCount: 1 });

    expect(
      (await computeIssueIntelligence(repo.id, 1))?.signals.map((s) => s.type),
    ).toContain("high_discussion");
    expect(
      (await computeIssueIntelligence(repo.id, 2))?.signals.map((s) => s.type),
    ).not.toContain("high_discussion");
  });

  it("flags discussion relative to a quiet repository baseline", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    await addIssue(repo.id, { number: 1, commentsCount: 0 });
    await addIssue(repo.id, { number: 2, commentsCount: 6 });

    const types =
      (await computeIssueIntelligence(repo.id, 2))?.signals.map((s) => s.type) ?? [];
    // Repo mean is 3 → relative bar max(5, 9) = 9 → 6 comments stays quiet.
    expect(types).not.toContain("high_discussion");
  });

  it("connects issues to PRs and commits with evidence", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    const db = getDb();
    const issue = await addIssue(repo.id, { number: 1 });
    const [pr] = await db
      .insert(pullRequests)
      .values({
        repositoryId: repo.id,
        githubId: `gh-ipr-${uniqueSuffix()}`,
        number: 219,
        title: "Fix loop",
        state: "closed",
        merged: true,
      })
      .returning({ id: pullRequests.id });
    await db.insert(issuePrLinks).values({
      issueId: issue.id,
      pullRequestId: pr.id,
      repositoryId: repo.id,
      relation: "closed_by",
      evidence: "pr-body:219:closes #1",
    });
    const commit = await addCommit(repo.id, {
      sha: sha("a"),
      message: "fix loop (#1)",
      path: "src/auth/session.ts",
      daysAgo: 2,
    });
    await db.insert(issueCommitLinks).values({
      issueId: issue.id,
      commitId: commit.id,
      repositoryId: repo.id,
      evidence: "commit-message:aaa:#1",
    });

    const intel = await computeIssueIntelligence(repo.id, 1);
    expect(intel?.dimensions.codeConnected).toBe(true);
    expect(intel?.dimensions.linkedPrCount).toBe(1);
    expect(intel?.dimensions.linkedCommitCount).toBe(1);
    expect(intel?.signals.map((s) => s.type)).toContain("code_connected");
    expect(intel?.linkedPrs[0]).toMatchObject({ number: 219, relation: "closed_by" });
    expect(intel?.files.map((f) => f.path)).toEqual(["src/auth/session.ts"]);
  });

  it("overlaps connected files with real risk findings", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    const db = getDb();
    const issue = await addIssue(repo.id, { number: 1 });
    // Five window commits on one path → hot_file risk finding.
    for (let i = 0; i < 5; i++) {
      await addCommit(repo.id, {
        sha: sha("h", String(i)),
        message: `tweak ${i}`,
        path: "src/payment/retry.ts",
        daysAgo: i + 1,
      });
    }
    const linked = await addCommit(repo.id, {
      sha: sha("z"),
      message: "fix retry (#1)",
      path: "src/payment/retry.ts",
      daysAgo: 1,
    });
    await db.insert(issueCommitLinks).values({
      issueId: issue.id,
      commitId: linked.id,
      repositoryId: repo.id,
      evidence: "commit-message:zzz:#1",
    });

    const intel = await computeIssueIntelligence(repo.id, 1);
    const types = intel?.signals.map((s) => s.type) ?? [];
    expect(types).toContain("risk_overlap");
    expect(intel?.riskFindings.length).toBeGreaterThan(0);
    expect(intel?.riskFindings[0].id).toMatch(/^v1:/);
    expect(intel?.files.find((f) => f.path === "src/payment/retry.ts")?.hot).toBe(true);
  });

  it("surfaces corrective context without diagnosing", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    const db = getDb();
    const issue = await addIssue(repo.id, { number: 1 });
    const commit = await addCommit(repo.id, {
      sha: sha("c"),
      message: "fix regression in session (#1)",
      path: "src/auth/session.ts",
      daysAgo: 3,
    });
    await db.insert(issueCommitLinks).values({
      issueId: issue.id,
      commitId: commit.id,
      repositoryId: repo.id,
      evidence: "commit-message:ccc:#1",
    });

    const types =
      (await computeIssueIntelligence(repo.id, 1))?.signals.map((s) => s.type) ?? [];
    expect(types).toContain("corrective_context");
  });

  it("is deterministic across repeated computation", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    await addIssue(repo.id, { number: 1, commentsCount: 12 });

    const first = await computeIssueIntelligence(repo.id, 1);
    const second = await computeIssueIntelligence(repo.id, 1);
    expect(second?.signals.map((s) => s.type)).toEqual(
      first?.signals.map((s) => s.type),
    );
    expect(second?.dimensions).toEqual(first?.dimensions);
  });

  it("derives signals purely (stable helper, fixed order)", () => {
    const base = {
      issue: {
        id: "i",
        repositoryId: "r",
        githubId: "1",
        number: 1,
        title: "T",
        body: null,
        state: "open",
        stateReason: null,
        authorLogin: "a",
        authorGithubId: null,
        authorAssociation: null,
        htmlUrl: null,
        locked: false,
        commentsCount: 12,
        labels: [],
        milestoneNumber: null,
        milestoneTitle: null,
        milestoneState: null,
        assignees: [],
        githubCreatedAt: daysAgo(45),
        githubUpdatedAt: hoursAgo(1),
        closedAt: null,
      },
      ageDays: 45,
      daysSinceUpdate: 0,
      recentCommentCount: 3,
      linkedPrs: [],
      linkedCommits: [],
      correctivePaths: new Set<string>(),
      riskFindings: [],
      repoMeanComments: 1,
    };
    const types = deriveIssueSignals(base).map((s) => s.type);
    expect(types).toEqual(["stale_open", "high_discussion", "recently_active"]);
  });

  it("filters, sorts, and scopes issue lists", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    const other = await setupRepo(login.user.id);
    await addIssue(repo.id, {
      number: 1,
      state: "open",
      labels: ["bug"],
      authorLogin: "alice",
      commentsCount: 2,
      githubUpdatedAt: hoursAgo(5),
    });
    await addIssue(repo.id, {
      number: 2,
      state: "closed",
      labels: ["docs"],
      authorLogin: "bob",
      commentsCount: 9,
      githubUpdatedAt: hoursAgo(1),
    });
    await addIssue(other.id, { number: 1 });

    expect((await listIssues(repo.id, { state: "open" })).data.map((i) => i.number)).toEqual([1]);
    expect(
      (await listIssues(repo.id, { state: "all", label: "docs" })).data.map((i) => i.number),
    ).toEqual([2]);
    expect(
      (await listIssues(repo.id, { state: "all", author: "BOB" })).data.map((i) => i.number),
    ).toEqual([2]);
    const byComments = await listIssues(repo.id, { state: "all", sort: "comments" });
    expect(byComments.data.map((i) => i.number)).toEqual([2, 1]);
    const paged = await listIssues(repo.id, { state: "all", page: 2, perPage: 1 });
    expect(paged.pagination).toMatchObject({ page: 2, perPage: 1, total: 2 });
    expect(paged.data).toHaveLength(1);
    // Cross-repository isolation.
    expect((await listIssues(other.id)).data.map((i) => i.number)).toEqual([1]);
  });

  it("retains recent comments for activity context", async () => {
    const login = await setupUser();
    const repo = await setupRepo(login.user.id);
    const db = getDb();
    const issue = await addIssue(repo.id, { number: 1 });
    await db.insert(issueComments).values({
      issueId: issue.id,
      repositoryId: repo.id,
      githubId: "c-1",
      authorLogin: "carol",
      body: "Reproduced.",
      githubCreatedAt: hoursAgo(4),
      githubUpdatedAt: hoursAgo(4),
    });

    const intel = await computeIssueIntelligence(repo.id, 1);
    expect(intel?.dimensions.recentCommentCount).toBe(1);
    expect(intel?.recentComments[0]).toMatchObject({ githubId: "c-1", authorLogin: "carol" });
  });
});
