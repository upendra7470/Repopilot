import { describe, it, expect, beforeEach } from "vitest";
import { getEngineeringTimeline } from "../memory.service.js";
import { getRepositoryOverview } from "../overview.service.js";
import { handleGithubIdentity } from "../github-auth.service.js";
import {
  createRepository,
  linkUserRepository,
} from "../repository.service.js";
import { getDb } from "../../db/index.js";
import {
  ciRuns,
  ciWorkflows,
  commits,
  contributors,
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

async function setupRepo() {
  const suffix = uniqueSuffix();
  const login = await handleGithubIdentity(
    {
      githubId: `gh-ov-${suffix}`,
      login: `ov-${suffix}`,
      name: null,
      email: null,
      avatarUrl: null,
    },
    { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
  );
  const record = await createRepository({
    githubId: `gh-ov-repo-${suffix}`,
    owner: "o",
    name: `r-${suffix}`,
    fullName: `o/r-${suffix}`,
  });
  await linkUserRepository(login.user.id, record.id, "owner");
  return { userId: login.user.id, record };
}

describe("Repository overview aggregate", () => {
  beforeEach(() => {
    setupEnv();
  });

  it("returns null for unknown repositories", async () => {
    expect(
      await getRepositoryOverview("00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("composes real counts, attention, and events without invented metrics", async () => {
    const { record } = await setupRepo();
    const db = getDb();
    const [alice] = await db
      .insert(contributors)
      .values({ repositoryId: record.id, login: "alice", name: "Alice" })
      .returning({ id: contributors.id });
    await db.insert(commits).values({
      repositoryId: record.id,
      sha: "a".repeat(40),
      message: "init",
      authorLogin: "alice",
      contributorId: alice.id,
      committedAt: hoursAgo(5),
    });
    await db.insert(pullRequests).values({
      repositoryId: record.id,
      githubId: "gh-pr-1",
      number: 7,
      title: "Tweak",
      state: "open",
      authorLogin: "bob",
      githubCreatedAt: hoursAgo(4),
      githubUpdatedAt: hoursAgo(3),
    });
    await db.insert(issues).values({
      repositoryId: record.id,
      githubId: "gh-issue-1",
      number: 3,
      title: "Stuck loop",
      state: "open",
      authorLogin: "carol",
      commentsCount: 0,
      githubCreatedAt: daysAgo(45),
      githubUpdatedAt: daysAgo(40),
    });
    const [workflow] = await db
      .insert(ciWorkflows)
      .values({ repositoryId: record.id, githubId: "100", name: "CI", state: "active" })
      .returning({ id: ciWorkflows.id });
    await db.insert(ciRuns).values({
      repositoryId: record.id,
      workflowId: workflow.id,
      githubId: "812",
      runNumber: 812,
      name: "CI",
      event: "push",
      status: "completed",
      conclusion: "failure",
      headBranch: "main",
      headSha: "a".repeat(40),
      githubCreatedAt: hoursAgo(2),
      githubUpdatedAt: hoursAgo(2),
    });

    const overview = await getRepositoryOverview(record.id);
    expect(overview?.repository).toMatchObject({
      id: record.id,
      fullName: record.fullName,
      syncStatus: "idle",
    });
    expect(overview?.counts).toMatchObject({
      commits: 1,
      prs: { open: 1, merged: 0, closed: 0 },
      issues: { open: 1, closed: 0 },
      workflows: 1,
      runs: 1,
    });
    // No health scores anywhere in the payload.
    expect(JSON.stringify(overview)).not.toMatch(/health|score/i);

    // Attention traces to real records with repository-scoped hrefs.
    const kinds = (overview?.attention ?? []).map((a) => a.kind);
    expect(kinds).toContain("ci");
    expect(kinds).toContain("issue");
    for (const item of overview?.attention ?? []) {
      expect(item.href).toContain(`repositoryId=${record.id}`);
      expect(item.title.length).toBeGreaterThan(0);
    }

    // Events merge kinds newest-first with entity refs.
    const events = overview?.recentEvents ?? [];
    expect(events.length).toBe(4);
    const eventKinds = events.map((e) => e.kind).sort();
    expect(eventKinds).toEqual(["ci_run", "commit", "issue", "pr"]);
    const times = events.map((e) => e.at?.getTime() ?? 0);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    for (const event of events) {
      expect(event.ref.value.length).toBeGreaterThan(0);
    }

    expect(overview?.recentPrs.map((p) => p.number)).toEqual([7]);
    expect(overview?.recentIssues.map((i) => i.number)).toEqual([3]);
    expect(overview?.topContributors.map((c) => c.login)).toEqual(["alice"]);
  });

  it("scopes a second repository independently", async () => {
    const first = await setupRepo();
    const second = await setupRepo();
    const db = getDb();
    await db.insert(commits).values({
      repositoryId: first.record.id,
      sha: "b".repeat(40),
      message: "only in first",
      committedAt: hoursAgo(1),
    });

    const a = await getRepositoryOverview(first.record.id);
    const b = await getRepositoryOverview(second.record.id);
    expect(a?.counts.commits).toBe(1);
    expect(b?.counts.commits).toBe(0);
    expect(b?.recentEvents).toEqual([]);
    expect(b?.attention).toEqual([]);
  });
});

describe("Engineering timeline", () => {
  beforeEach(() => {
    setupEnv();
  });

  it("returns an empty stream for repositories without activity", async () => {
    const { record } = await setupRepo();
    expect(await getEngineeringTimeline(record.id)).toEqual([]);
  });

  it("never invents verbs — states are observed values", async () => {
    const { record } = await setupRepo();
    const db = getDb();
    await db.insert(pullRequests).values({
      repositoryId: record.id,
      githubId: "gh-pr-9",
      number: 9,
      title: "Tweak",
      state: "open",
      merged: false,
      githubUpdatedAt: hoursAgo(1),
    });

    const [item] = await getEngineeringTimeline(record.id);
    expect(item.kind).toBe("pr");
    expect(item.title).not.toMatch(/opened/i);
    expect(item.ref).toEqual({ entity: "pr", value: "9" });
  });
});
