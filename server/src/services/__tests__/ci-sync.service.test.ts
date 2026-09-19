import { describe, it, expect, vi, beforeEach } from "vitest";
import { count, eq } from "drizzle-orm";
import { handleGithubIdentity } from "../github-auth.service.js";
import { syncCi } from "../ci-sync.service.js";
import {
  createRepository,
  linkUserRepository,
} from "../repository.service.js";
import { getDb } from "../../db/index.js";
import { ciJobs, ciRuns, ciWorkflows } from "../../db/schema.js";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    workflows: [] as Array<Record<string, unknown>>,
    runs: [] as Array<Record<string, unknown>>,
    jobsByRun: {} as Record<number, Array<Record<string, unknown>>>,
  },
}));

vi.mock("../github-provider.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../github-provider.js")>();
  return {
    ...original,
    listGithubWorkflows: vi.fn(async () => mockState.workflows),
    listGithubWorkflowRuns: vi.fn(async () => mockState.runs),
    listGithubRunJobs: vi.fn(
      async (_t: string, _o: string, _n: string, runId: number) =>
        mockState.jobsByRun[runId] ?? [],
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

function ghWorkflow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `CI ${id}`,
    path: ".github/workflows/ci.yml",
    state: "active",
    badgeUrl: null,
    htmlUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function ghRun(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workflowId: 100,
    runNumber: id,
    name: "CI",
    event: "push",
    status: "completed",
    conclusion: "success",
    headBranch: "main",
    headSha: "a".repeat(40),
    runAttempt: 1,
    actorLogin: "alice",
    prNumbers: [],
    htmlUrl: `https://github.com/o/r/actions/runs/${id}`,
    createdAt: "2026-09-02T10:00:00Z",
    updatedAt: "2026-09-02T10:05:00Z",
    startedAt: "2026-09-02T10:01:00Z",
    ...overrides,
  };
}

function ghJob(id: number, conclusion: string | null = "success") {
  return {
    id,
    name: `job-${id}`,
    status: "completed",
    conclusion,
    startedAt: "2026-09-02T10:01:00Z",
    completedAt: "2026-09-02T10:02:00Z",
    htmlUrl: null,
  };
}

async function setupRepo() {
  const suffix = uniqueSuffix();
  const login = await handleGithubIdentity(
    {
      githubId: `gh-ci-${suffix}`,
      login: `ci-${suffix}`,
      name: null,
      email: null,
      avatarUrl: null,
    },
    { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
  );
  const record = await createRepository({
    githubId: `gh-ci-repo-${suffix}`,
    owner: "o",
    name: `r-${suffix}`,
    fullName: `o/r-${suffix}`,
  });
  await linkUserRepository(login.user.id, record.id, "owner");
  return record;
}

describe("CI sync", () => {
  beforeEach(() => {
    setupEnv();
    mockState.workflows = [];
    mockState.runs = [];
    mockState.jobsByRun = {};
  });

  it("ingests workflows, runs, and jobs idempotently", async () => {
    const repo = await setupRepo();
    mockState.workflows = [ghWorkflow(100)];
    mockState.runs = [ghRun(812, { conclusion: "failure" })];
    mockState.jobsByRun = { 812: [ghJob(1, "failure"), ghJob(2)] };

    const first = await syncCi(repo.id, "token", "o", "r");
    expect(first).toEqual({ workflowCount: 1, runCount: 1, jobCount: 2 });

    const second = await syncCi(repo.id, "token", "o", "r");
    expect(second).toEqual({ workflowCount: 1, runCount: 1, jobCount: 2 });

    const db = getDb();
    expect(
      (await db.select({ n: count() }).from(ciWorkflows).where(eq(ciWorkflows.repositoryId, repo.id)))[0].n,
    ).toBe(1);
    expect(
      (await db.select({ n: count() }).from(ciRuns).where(eq(ciRuns.repositoryId, repo.id)))[0].n,
    ).toBe(1);
    expect(
      (await db.select({ n: count() }).from(ciJobs).where(eq(ciJobs.repositoryId, repo.id)))[0].n,
    ).toBe(2);
  });

  it("transitions in-progress runs to completed with duration", async () => {
    const repo = await setupRepo();
    mockState.workflows = [ghWorkflow(100)];
    mockState.runs = [
      ghRun(812, { status: "in_progress", conclusion: null, updatedAt: "2026-09-02T10:02:00Z" }),
    ];
    await syncCi(repo.id, "token", "o", "r");

    mockState.runs = [
      ghRun(812, { status: "completed", conclusion: "failure", updatedAt: "2026-09-02T10:05:00Z" }),
    ];
    await syncCi(repo.id, "token", "o", "r");

    const db = getDb();
    const rows = await db.select().from(ciRuns).where(eq(ciRuns.repositoryId, repo.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("completed");
    expect(rows[0].conclusion).toBe("failure");
    // completed ≈ updated_at (10:05) − started (10:01) = 240s.
    expect(rows[0].durationSec).toBe(240);
  });

  it("keeps status and conclusion separate for running runs", async () => {
    const repo = await setupRepo();
    mockState.workflows = [ghWorkflow(100)];
    mockState.runs = [ghRun(812, { status: "in_progress", conclusion: null })];
    await syncCi(repo.id, "token", "o", "r");

    const db = getDb();
    const rows = await db.select().from(ciRuns).where(eq(ciRuns.repositoryId, repo.id));
    expect(rows[0].status).toBe("in_progress");
    expect(rows[0].conclusion).toBeNull();
    expect(rows[0].durationSec).toBeNull();
  });

  it("skips runs whose workflow is unknown and prunes stale runs", async () => {
    const repo = await setupRepo();
    mockState.workflows = [ghWorkflow(100)];
    mockState.runs = [
      ghRun(812),
      ghRun(813, { workflowId: 999 }),
      ghRun(814, { createdAt: "2026-01-01T00:00:00Z" }),
    ];
    const result = await syncCi(repo.id, "token", "o", "r");
    expect(result.runCount).toBe(2);

    // The old run falls out of retention on the next sync.
    mockState.runs = [ghRun(812)];
    await syncCi(repo.id, "token", "o", "r");
    const db = getDb();
    const githubIds = (
      await db.select({ githubId: ciRuns.githubId }).from(ciRuns).where(eq(ciRuns.repositoryId, repo.id))
    ).map((r) => r.githubId);
    expect(githubIds).toEqual(["812"]);
  });

  it("bounds jobs per run and prunes removed jobs", async () => {
    const repo = await setupRepo();
    mockState.workflows = [ghWorkflow(100)];
    mockState.runs = [ghRun(812)];
    mockState.jobsByRun = {
      812: Array.from({ length: 25 }, (_, i) => ghJob(i + 1)),
    };

    const result = await syncCi(repo.id, "token", "o", "r");
    expect(result.jobCount).toBe(20);

    mockState.jobsByRun = { 812: [ghJob(25)] };
    await syncCi(repo.id, "token", "o", "r");
    const db = getDb();
    const stored = await db.select().from(ciJobs).where(eq(ciJobs.repositoryId, repo.id));
    expect(stored.map((j) => j.githubId)).toEqual(["25"]);
  });

  it("handles repositories with no workflows", async () => {
    const repo = await setupRepo();
    expect(await syncCi(repo.id, "token", "o", "r")).toEqual({
      workflowCount: 0,
      runCount: 0,
      jobCount: 0,
    });
  });
});
