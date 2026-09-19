import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetEnv } from "../../config/env.js";
import { resetLogger } from "../../utils/logger.js";
import {
  getLatestPrAnalysis,
  requestPrAnalysis,
} from "../pr-analysis.service.js";
import { handleGithubIdentity } from "../github-auth.service.js";
import {
  createRepository,
  linkUserRepository,
} from "../repository.service.js";
import { getDb } from "../../db/index.js";
import { commits, commitFiles, prFiles, pullRequests } from "../../db/schema.js";

function setupEnv(overrides: Record<string, string | undefined> = {}): void {
  resetEnv();
  resetLogger();
  process.env.DATABASE_URL = "postgresql://localhost:5432/repopilot_test";
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.AUTH_SECRET = "test-only-auth-secret-at-least-32-chars!!";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const VALID_ANALYSIS = {
  summary: "Modifies session handling across 2 files.",
  riskLevel: "medium",
  keyChanges: ["session validation"],
  riskFactors: [{ claim: "Hot file touched.", evidenceIds: ["file:src/a.ts"] }],
  evidence: [
    { id: "file:src/a.ts", kind: "file", label: "src/a.ts", detail: "modified" },
  ],
  reviewFocus: ["Check invalidation."],
  unknowns: ["No test results supplied."],
};

function chatResponse(content: unknown) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }),
  };
}

describe("Grounded PR analysis", () => {
  beforeEach(() => {
    setupEnv({ AI_API_KEY: "sk-test" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setupEnv();
  });

  async function seededPr() {
    const suffix = uniqueSuffix();
    const login = await handleGithubIdentity(
      {
        githubId: `gh-pa-${suffix}`,
        login: `pa-${suffix}`,
        name: null,
        email: null,
        avatarUrl: null,
      },
      { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
    );
    const record = await createRepository({
      githubId: `gh-pa-repo-${suffix}`,
      owner: "o",
      name: `r-${suffix}`,
      fullName: `o/r-${suffix}`,
    });
    await linkUserRepository(login.user.id, record.id, "owner");
    const db = getDb();
    const [pr] = await db
      .insert(pullRequests)
      .values({
        repositoryId: record.id,
        githubId: `gh-pr-${suffix}`,
        number: 7,
        title: "Tweak session handling",
        body: "Small cleanup.",
        state: "open",
        authorLogin: "bob",
        sourceBranch: "tweak",
        targetBranch: "main",
        additions: 50,
        deletions: 10,
        changedFilesCount: 1,
        githubCreatedAt: new Date(),
      })
      .returning({ id: pullRequests.id });
    const [commit] = await db
      .insert(commits)
      .values({
        repositoryId: record.id,
        sha: "a".repeat(40),
        message: "tweak",
        authorLogin: "bob",
        committedAt: new Date(),
      })
      .returning({ id: commits.id });
    await db.insert(commitFiles).values({
      commitId: commit.id,
      repositoryId: record.id,
      path: "src/a.ts",
      status: "modified",
    });
    await db.insert(prFiles).values({
      pullRequestId: pr.id,
      repositoryId: record.id,
      path: "src/a.ts",
      status: "modified",
      additions: 50,
      deletions: 10,
    });
    return { repositoryId: record.id };
  }

  it("returns unavailable state when AI is not configured", async () => {
    setupEnv();
    const { repositoryId } = await seededPr();

    const result = await requestPrAnalysis(repositoryId, 7);

    expect(result.status).toBe("unavailable");
    expect(result.analysis).toBeNull();
    expect(result.error?.code).toBe("AI_UNAVAILABLE");
  });

  it("completes, validates, sanitizes evidence refs, and caches", async () => {
    const { repositoryId } = await seededPr();
    const fetchMock = vi.fn().mockResolvedValue(
      chatResponse({
        ...VALID_ANALYSIS,
        riskFactors: [
          { claim: "Hot file touched.", evidenceIds: ["file:src/a.ts"] },
          { claim: "Bogus claim.", evidenceIds: ["file:nope.ts"] },
        ],
        extraField: "dropped",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await requestPrAnalysis(repositoryId, 7);
    expect(first.status).toBe("completed");
    expect(first.cached).toBe(false);
    expect(first.analysis?.riskLevel).toBe("medium");
    // Only supplied evidence IDs survive.
    expect(first.analysis?.riskFactors).toHaveLength(1);
    expect(first.analysis?.riskFactors[0].evidenceIds).toEqual(["file:src/a.ts"]);
    expect(first.analysis).not.toHaveProperty("extraField");

    // Prompt carries evidence but never credentials.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const prompt = String(JSON.parse(String(init?.body)).messages[1].content);
    expect(prompt).toContain("src/a.ts");
    expect(prompt).not.toMatch(/sk-test|Bearer|token/i);

    // Identical evidence reuses the stored result without a model call.
    const second = await requestPrAnalysis(repositoryId, 7);
    expect(second.status).toBe("completed");
    expect(second.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.analysis).toEqual(first.analysis);
  });

  it("records failures without crashing and keeps deterministic output", async () => {
    const { repositoryId } = await seededPr();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(chatResponse("definitely not json {{{")),
    );

    const result = await requestPrAnalysis(repositoryId, 7);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("AI_BAD_RESPONSE");
    expect(result.analysis).toBeNull();

    const latest = await getLatestPrAnalysis(repositoryId, 7);
    expect(latest?.status).toBe("failed");
  });

  it("rejects malformed model JSON that violates the schema", async () => {
    const { repositoryId } = await seededPr();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(chatResponse({ summary: 42 })),
    );

    const result = await requestPrAnalysis(repositoryId, 7);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("AI_BAD_RESPONSE");
  });

  it("returns null latest analysis for unknown PRs", async () => {
    const { repositoryId } = await seededPr();
    expect(await getLatestPrAnalysis(repositoryId, 999)).toBeNull();
  });

  it("getLatest returns unavailable when never analyzed", async () => {
    setupEnv();
    const { repositoryId } = await seededPr();
    const latest = await getLatestPrAnalysis(repositoryId, 7);
    expect(latest?.status).toBe("unavailable");
    expect(latest?.analysis).toBeNull();
  });
});
