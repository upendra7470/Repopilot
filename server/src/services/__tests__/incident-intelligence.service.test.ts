import { describe, it, expect, beforeEach } from "vitest";
import {
  detectIncidents,
  getIncident,
} from "../incident-intelligence.service.js";
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
  commitFiles,
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

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const SHA = (ch: string) => ch.repeat(40);

async function setupRepo() {
  const suffix = uniqueSuffix();
  const login = await handleGithubIdentity(
    {
      githubId: `gh-in-${suffix}`,
      login: `in-${suffix}`,
      name: null,
      email: null,
      avatarUrl: null,
    },
    { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
  );
  const record = await createRepository({
    githubId: `gh-in-repo-${suffix}`,
    owner: "o",
    name: `r-${suffix}`,
    fullName: `o/r-${suffix}`,
  });
  await linkUserRepository(login.user.id, record.id, "owner");
  return record;
}

async function addWorkflow(repositoryId: string, githubId = "100", name = "CI") {
  const db = getDb();
  const [row] = await db
    .insert(ciWorkflows)
    .values({ repositoryId, githubId, name, path: ".github/workflows/ci.yml", state: "active" })
    .returning();
  return row;
}

async function addRun(
  repositoryId: string,
  workflowId: string,
  seed: {
    githubId: string;
    runNumber?: number;
    status?: string | null;
    conclusion?: string | null;
    branch?: string | null;
    sha?: string | null;
    hoursAgo?: number;
    prNumbers?: number[];
  },
) {
  const db = getDb();
  const created = seed.hoursAgo !== undefined ? hoursAgo(seed.hoursAgo) : hoursAgo(1);
  const [row] = await db
    .insert(ciRuns)
    .values({
      repositoryId,
      workflowId,
      githubId: seed.githubId,
      runNumber: seed.runNumber ?? Number(seed.githubId),
      name: "CI",
      event: "push",
      status: seed.status ?? "completed",
      conclusion: seed.conclusion ?? "success",
      headBranch: seed.branch ?? "main",
      headSha: seed.sha ?? SHA("a"),
      runAttempt: 1,
      actorLogin: "alice",
      prNumbers: seed.prNumbers ?? [],
      githubCreatedAt: created,
      githubUpdatedAt: created,
      startedAt: created,
      completedAt: seed.status === "in_progress" ? null : created,
    })
    .returning();
  return row;
}

describe("Incident detection", () => {
  beforeEach(() => {
    setupEnv();
  });

  it("emits nothing for empty repositories", async () => {
    const repo = await setupRepo();
    expect(await detectIncidents(repo.id)).toEqual([]);
    expect(await getIncident(repo.id, "a".repeat(64))).toBeNull();
  });

  it("emits nothing for a single failure or a pair", async () => {
    const repo = await setupRepo();
    const wf = await addWorkflow(repo.id);
    await addRun(repo.id, wf.id, { githubId: "1", conclusion: "failure", hoursAgo: 2 });
    await addRun(repo.id, wf.id, { githubId: "2", conclusion: "failure", hoursAgo: 1 });
    expect(await detectIncidents(repo.id)).toEqual([]);
  });

  it("detects a burst as an active incident with stable identity", async () => {
    const repo = await setupRepo();
    const wf = await addWorkflow(repo.id);
    await addRun(repo.id, wf.id, { githubId: "1", conclusion: "failure", hoursAgo: 3 });
    await addRun(repo.id, wf.id, { githubId: "2", conclusion: "failure", hoursAgo: 2 });
    await addRun(repo.id, wf.id, { githubId: "3", conclusion: "failure", hoursAgo: 1 });

    const first = await detectIncidents(repo.id);
    expect(first).toHaveLength(1);
    const incident = first[0];
    expect(incident.status).toBe("active");
    expect(incident.severity).toBe("high"); // main branch burst
    expect(incident.burstLength).toBe(3);
    expect(incident.confidence).toBe("high");
    expect(incident.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(incident.unknowns.join(" ")).toMatch(/outage/i);

    // Idempotent: repeated detection yields the same fingerprint.
    const second = await detectIncidents(repo.id);
    expect(second.map((i) => i.fingerprint)).toEqual([incident.fingerprint]);
    expect(await getIncident(repo.id, incident.fingerprint)).not.toBeNull();
    expect(await getIncident(repo.id, "b".repeat(64))).toBeNull();
    expect(await getIncident(repo.id, "not-hex")).toBeNull();
  });

  it("marks recovery when success follows the burst", async () => {
    const repo = await setupRepo();
    const wf = await addWorkflow(repo.id);
    await addRun(repo.id, wf.id, { githubId: "1", conclusion: "failure", hoursAgo: 4 });
    await addRun(repo.id, wf.id, { githubId: "2", conclusion: "failure", hoursAgo: 3 });
    await addRun(repo.id, wf.id, { githubId: "3", conclusion: "failure", hoursAgo: 2 });
    await addRun(repo.id, wf.id, { githubId: "4", conclusion: "success", hoursAgo: 1 });

    const [incident] = await detectIncidents(repo.id);
    expect(incident.status).toBe("recovered");
    expect(incident.recoveryRunGithubId).toBe("4");
    expect(incident.summary).toMatch(/Recovery observed/);
    expect(incident.summary).not.toMatch(/caused|root cause/i);
  });

  it("keeps unrelated workflows and branches separate", async () => {
    const repo = await setupRepo();
    const ci = await addWorkflow(repo.id, "100", "CI");
    const deploy = await addWorkflow(repo.id, "200", "Deploy");
    for (const n of ["1", "2", "3"]) {
      await addRun(repo.id, ci.id, { githubId: n, conclusion: "failure", branch: "main", hoursAgo: 4 - Number(n) });
    }
    for (const n of ["4", "5", "6"]) {
      await addRun(repo.id, deploy.id, { githubId: n, conclusion: "failure", branch: "main", hoursAgo: 4 - Number(n) });
    }
    for (const n of ["7", "8", "9"]) {
      await addRun(repo.id, ci.id, { githubId: n, conclusion: "failure", branch: "feature", hoursAgo: 4 - Number(n) });
    }

    const incidents = await detectIncidents(repo.id);
    expect(incidents).toHaveLength(3);
    const keys = incidents.map((i) => `${i.workflowGithubId}:${i.branch}`).sort();
    expect(keys).toEqual(["100:feature", "100:main", "200:main"]);
    expect(new Set(incidents.map((i) => i.fingerprint)).size).toBe(3);
  });

  it("ignores non-contiguous failures interrupted by success", async () => {
    const repo = await setupRepo();
    const wf = await addWorkflow(repo.id);
    await addRun(repo.id, wf.id, { githubId: "1", conclusion: "failure", hoursAgo: 5 });
    await addRun(repo.id, wf.id, { githubId: "2", conclusion: "failure", hoursAgo: 4 });
    await addRun(repo.id, wf.id, { githubId: "3", conclusion: "success", hoursAgo: 3 });
    await addRun(repo.id, wf.id, { githubId: "4", conclusion: "failure", hoursAgo: 2 });
    await addRun(repo.id, wf.id, { githubId: "5", conclusion: "failure", hoursAgo: 1 });

    // Newest burst is only 2 long → no incident (older pair is shadowed).
    expect(await detectIncidents(repo.id)).toEqual([]);
  });

  it("scopes incidents per repository", async () => {
    const first = await setupRepo();
    const second = await setupRepo();
    const wf = await addWorkflow(first.id);
    for (const n of ["1", "2", "3"]) {
      await addRun(first.id, wf.id, { githubId: n, conclusion: "failure", hoursAgo: 4 - Number(n) });
    }
    expect((await detectIncidents(first.id)).length).toBe(1);
    expect(await detectIncidents(second.id)).toEqual([]);
  });

  it("links commits, PRs, issues, files, risks, and contributors as evidence", async () => {
    const repo = await setupRepo();
    const db = getDb();
    const wf = await addWorkflow(repo.id);
    // Hot-file risk: 5 window commits on one path.
    for (let i = 0; i < 5; i++) {
      const [commit] = await db
        .insert(commits)
        .values({
          repositoryId: repo.id,
          sha: `${String(i).repeat(38)}${String(i).padStart(2, "0")}`.slice(0, 40),
          message: `tweak ${i}`,
          authorLogin: "zoe",
          committedAt: daysAgo(i + 1),
        })
        .returning({ id: commits.id });
      await db.insert(commitFiles).values({
        commitId: commit.id,
        repositoryId: repo.id,
        path: "src/auth/session.ts",
        status: "modified",
      });
    }
    const [linkedCommit] = await db
      .insert(commits)
      .values({
        repositoryId: repo.id,
        sha: SHA("c"),
        message: "fix session",
        authorLogin: "bob",
        committedAt: daysAgo(0),
      })
      .returning({ id: commits.id });
    await db.insert(commitFiles).values({
      commitId: linkedCommit.id,
      repositoryId: repo.id,
      path: "src/auth/session.ts",
      status: "modified",
    });
    const [pr] = await db
      .insert(pullRequests)
      .values({
        repositoryId: repo.id,
        githubId: "gh-pr-42",
        number: 42,
        title: "Session fix",
        state: "closed",
        merged: true,
        authorLogin: "bob",
      })
      .returning({ id: pullRequests.id });
    const [issue] = await db
      .insert(issues)
      .values({
        repositoryId: repo.id,
        githubId: "gh-issue-7",
        number: 7,
        title: "Session flakes",
        state: "open",
      })
      .returning({ id: issues.id });
    await db.insert(issuePrLinks).values({
      issueId: issue.id,
      pullRequestId: pr.id,
      repositoryId: repo.id,
      relation: "closed_by",
      evidence: "pr-body:42:fixes #7",
    });
    for (const n of ["1", "2", "3"]) {
      await addRun(repo.id, wf.id, {
        githubId: n,
        conclusion: "failure",
        sha: SHA("c"),
        prNumbers: [42],
        hoursAgo: 4 - Number(n),
      });
    }

    const [incident] = await detectIncidents(repo.id);
    expect(incident.linkedPrNumbers).toEqual([42]);
    expect(incident.linkedIssueNumbers).toEqual([7]);
    expect(incident.filePaths).toEqual(["src/auth/session.ts"]);
    expect(incident.riskFindingIds.length).toBeGreaterThan(0);
    expect(incident.contributorLogins).toEqual(expect.arrayContaining(["bob"]));
    const kinds = incident.evidence.map((e) => e.kind);
    for (const kind of ["run", "workflow", "commit", "pr", "issue", "file", "risk", "contributor"] as const) {
      expect(kinds).toContain(kind);
    }
    // Timeline mixes failures and the linked commit, newest first.
    const timelineKinds = incident.timeline.map((t) => t.kind);
    expect(timelineKinds).toContain("ci_failure");
    expect(timelineKinds).toContain("commit");
    const times = incident.timeline.map((t) => t.at?.getTime() ?? 0);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // Association language only — never causal claims. (The unknowns
    // list explicitly states root cause is UNKNOWN, which must survive.)
    expect(JSON.stringify(incident)).not.toMatch(/caused by|root cause is|blame|responsible developer/i);
    expect(JSON.stringify(incident.unknowns)).toMatch(/root cause/i);
  });

  it("grades non-default branches as medium severity", async () => {
    const repo = await setupRepo();
    const wf = await addWorkflow(repo.id);
    for (const n of ["1", "2", "3"]) {
      await addRun(repo.id, wf.id, { githubId: n, conclusion: "failure", branch: "feature", hoursAgo: 4 - Number(n) });
    }
    const [incident] = await detectIncidents(repo.id);
    expect(incident.severity).toBe("medium");
  });
});
