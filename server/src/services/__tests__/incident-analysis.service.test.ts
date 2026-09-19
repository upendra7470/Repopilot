import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetEnv } from "../../config/env.js";
import { resetLogger } from "../../utils/logger.js";
import {
  getLatestIncidentAnalysis,
  requestIncidentAnalysis,
} from "../incident-analysis.service.js";
import { detectIncidents } from "../incident-intelligence.service.js";
import { handleGithubIdentity } from "../github-auth.service.js";
import {
  createRepository,
  linkUserRepository,
} from "../repository.service.js";
import { getDb } from "../../db/index.js";
import { ciRuns, ciWorkflows } from "../../db/schema.js";

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

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

const VALID_ANALYSIS = {
  summary: "Three consecutive CI failures on main; recovery not yet observed.",
  assessment: "medium",
  likelyContributingFactors: [
    { claim: "Failures may share the workflow configuration.", evidenceIds: [] },
  ],
  confirmedFacts: [
    { claim: "Three consecutive failures occurred.", evidenceIds: ["run:3"] },
  ],
  evidence: [
    { id: "run:3", kind: "run", label: "Run #3 failed", detail: "failure" },
  ],
  unknowns: ["Whether users experienced an outage."],
  investigationNextSteps: ["Inspect the failed runs in CI."],
};

function chatResponse(content: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () =>
      Promise.resolve({
        choices: [
          { message: { content: typeof content === "string" ? content : JSON.stringify(content) } },
        ],
      }),
  };
}

describe("Grounded incident analysis", () => {
  beforeEach(() => {
    setupEnv({ AI_API_KEY: "sk-test" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setupEnv();
  });

  async function seededBurst() {
    const suffix = uniqueSuffix();
    const login = await handleGithubIdentity(
      {
        githubId: `gh-ia-${suffix}`,
        login: `ia-${suffix}`,
        name: null,
        email: null,
        avatarUrl: null,
      },
      { accessToken: `test-only-token-${suffix}`, scope: "read:user user:email" },
    );
    const record = await createRepository({
      githubId: `gh-ia-repo-${suffix}`,
      owner: "o",
      name: `r-${suffix}`,
      fullName: `o/r-${suffix}`,
    });
    await linkUserRepository(login.user.id, record.id, "owner");
    const db = getDb();
    const [workflow] = await db
      .insert(ciWorkflows)
      .values({ repositoryId: record.id, githubId: "100", name: "CI", state: "active" })
      .returning({ id: ciWorkflows.id });
    for (const [i, conclusion] of ["failure", "failure", "failure"].entries()) {
      await db.insert(ciRuns).values({
        repositoryId: record.id,
        workflowId: workflow.id,
        githubId: String(i + 1),
        runNumber: i + 1,
        name: "CI",
        event: "push",
        status: "completed",
        conclusion,
        headBranch: "main",
        headSha: "a".repeat(40),
        githubCreatedAt: hoursAgo(3 - i),
        githubUpdatedAt: hoursAgo(3 - i),
      });
    }
    const [incident] = await detectIncidents(record.id);
    if (!incident) {
      throw new Error("seeded burst did not detect");
    }
    return { record, fingerprint: incident.fingerprint };
  }

  it("reports unavailable when no provider is configured", async () => {
    setupEnv();
    const { record, fingerprint } = await seededBurst();

    const result = await requestIncidentAnalysis(record.id, fingerprint);
    expect(result.status).toBe("unavailable");
    expect(result.error?.code).toBe("AI_UNAVAILABLE");
    expect(result.analysis).toBeNull();
  });

  it("returns structured analysis and caches by fingerprint", async () => {
    const { record, fingerprint } = await seededBurst();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(chatResponse(VALID_ANALYSIS)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestIncidentAnalysis(record.id, fingerprint);
    expect(result.status).toBe("completed");
    expect(result.cached).toBe(false);
    // Empty-evidence claims are dropped by the sanitizer.
    expect(result.analysis?.likelyContributingFactors ?? []).toEqual([]);
    expect(result.analysis?.confirmedFacts.map((f) => f.claim)).toEqual([
      "Three consecutive failures occurred.",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cached = await requestIncidentAnalysis(record.id, fingerprint);
    expect(cached.status).toBe("completed");
    expect(cached.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats injected outage demands as data: unsupported evidence is dropped", async () => {
    const { record, fingerprint } = await seededBurst();
    // The stubbed model echoes injected demands. The code layer guarantees:
    // claims citing only unsupported evidence are dropped, no fabricated
    // evidence entries survive, and unknowns stay explicit. (With a real
    // model, the system prompt's ignore-instructions + no-blame rules are
    // the behavioral defense; unit tests assert the structural guarantees.)
    const injected = {
      ...VALID_ANALYSIS,
      confirmedFacts: [
        { claim: "Production outage confirmed with user impact.", evidenceIds: ["impact:ghost"] },
        { claim: "Unit test auth_test failed with stack trace.", evidenceIds: ["log:ghost"] },
        { claim: "Three consecutive failures occurred.", evidenceIds: ["run:3"] },
      ],
      evidence: [
        ...VALID_ANALYSIS.evidence,
        { id: "impact:ghost", kind: "impact", label: "Outage", detail: "invented" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(chatResponse(injected))),
    );

    const result = await requestIncidentAnalysis(record.id, fingerprint);
    expect(result.status).toBe("completed");
    // Only the run-grounded fact survives; ghost evidence is gone.
    expect(result.analysis?.confirmedFacts.map((f) => f.claim)).toEqual([
      "Three consecutive failures occurred.",
    ]);
    expect(result.analysis?.evidence.map((e) => e.id)).not.toContain("impact:ghost");
    expect(result.analysis?.evidence.map((e) => e.id)).toContain("run:3");
  });

  it("fails honestly on malformed JSON, timeout, and rate limits", async () => {
    const { record, fingerprint } = await seededBurst();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(chatResponse("nope"))),
    );
    await expect(requestIncidentAnalysis(record.id, fingerprint)).resolves.toMatchObject({
      status: "failed",
      error: { code: "AI_BAD_RESPONSE", message: expect.any(String) },
    });

    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));
    await expect(requestIncidentAnalysis(record.id, fingerprint)).resolves.toMatchObject({
      status: "failed",
      error: { code: "AI_TIMEOUT", message: expect.any(String) },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(chatResponse({}, 429))),
    );
    await expect(requestIncidentAnalysis(record.id, fingerprint)).resolves.toMatchObject({
      status: "failed",
      error: { code: "AI_RATE_LIMITED", message: expect.any(String) },
    });
  });

  it("serves the latest stored analysis without calling the model", async () => {
    const { record, fingerprint } = await seededBurst();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(chatResponse(VALID_ANALYSIS))),
    );
    await requestIncidentAnalysis(record.id, fingerprint);

    vi.unstubAllGlobals();
    const exploding = vi.fn().mockImplementation(() => {
      throw new Error("model must not be called");
    });
    vi.stubGlobal("fetch", exploding);

    const latest = await getLatestIncidentAnalysis(record.id, fingerprint);
    expect(latest?.status).toBe("completed");
    expect(latest?.cached).toBe(true);
    expect(exploding).not.toHaveBeenCalled();
  });

  it("returns null analysis state for unknown fingerprints", async () => {
    const { record } = await seededBurst();
    expect(await getLatestIncidentAnalysis(record.id, "c".repeat(64))).toBeNull();
    await expect(requestIncidentAnalysis(record.id, "c".repeat(64))).rejects.toThrow(
      "Incident not found",
    );
  });
});
