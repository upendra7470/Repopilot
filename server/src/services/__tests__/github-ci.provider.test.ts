import { describe, it, expect, vi, afterEach } from "vitest";
import {
  listGithubRunJobs,
  listGithubWorkflowRuns,
  listGithubWorkflows,
} from "../github-provider.js";

function okJson(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  });
}

function workflowItem(id: number) {
  return {
    id,
    name: `CI ${id}`,
    path: ".github/workflows/ci.yml",
    state: "active",
    badge_url: "https://github.com/o/r/actions/workflows/ci/badge.svg",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

function runItem(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workflow_id: 100,
    run_number: id,
    name: "CI",
    event: "push",
    status: "completed",
    conclusion: "failure",
    head_branch: "main",
    head_sha: "a".repeat(40),
    run_attempt: 1,
    actor: { login: "alice" },
    pull_requests: [{ number: 219 }],
    html_url: `https://github.com/o/r/actions/runs/${id}`,
    created_at: "2026-09-02T10:00:00Z",
    updated_at: "2026-09-02T10:05:00Z",
    run_started_at: "2026-09-02T10:01:00Z",
    ...overrides,
  };
}

describe("GitHub Actions provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists workflows from the enveloped response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => okJson({ total_count: 1, workflows: [workflowItem(100)] })),
    );

    const workflows = await listGithubWorkflows("token", "o", "r");
    expect(workflows).toEqual([
      {
        id: 100,
        name: "CI 100",
        path: ".github/workflows/ci.yml",
        state: "active",
        badgeUrl: "https://github.com/o/r/actions/workflows/ci/badge.svg",
        htmlUrl: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
      },
    ]);
  });

  it("stops workflow pagination on a short page", async () => {
    const fetchMock = vi.fn().mockImplementation(() => okJson({ workflows: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listGithubWorkflows("token", "o", "r", 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes runs with PR associations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => okJson({ total_count: 1, workflow_runs: [runItem(812)] })),
    );

    const [run] = await listGithubWorkflowRuns("token", "o", "r");
    expect(run).toMatchObject({
      id: 812,
      workflowId: 100,
      runNumber: 812,
      status: "completed",
      conclusion: "failure",
      headBranch: "main",
      actorLogin: "alice",
      prNumbers: [219],
    });
  });

  it("keeps status and conclusion separate, including null conclusions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        okJson({ workflow_runs: [runItem(813, { status: "in_progress", conclusion: null })] }),
      ),
    );

    const [run] = await listGithubWorkflowRuns("token", "o", "r");
    expect(run.status).toBe("in_progress");
    expect(run.conclusion).toBeNull();
  });

  it("bounds run pagination to maxPages", async () => {
    const full = Array.from({ length: 100 }, (_, i) => runItem(1000 + i));
    const fetchMock = vi.fn().mockImplementation(() => okJson({ workflow_runs: full }));
    vi.stubGlobal("fetch", fetchMock);

    await listGithubWorkflowRuns("token", "o", "r", 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lists job outcomes without requesting logs or steps", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      okJson({
        total_count: 1,
        jobs: [
          {
            id: 1,
            name: "test",
            status: "completed",
            conclusion: "failure",
            started_at: "2026-09-02T10:01:00Z",
            completed_at: "2026-09-02T10:03:17Z",
            html_url: "https://github.com/o/r/runs/1",
          },
        ],
      }).then((res) => {
        // The jobs endpoint must never ask for logs/steps/annotations.
        expect(String(url)).not.toMatch(/logs|steps|annotations/);
        return res;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await listGithubRunJobs("token", "o", "r", 812);
    expect(jobs).toEqual([
      {
        id: 1,
        name: "test",
        status: "completed",
        conclusion: "failure",
        startedAt: "2026-09-02T10:01:00Z",
        completedAt: "2026-09-02T10:03:17Z",
        htmlUrl: "https://github.com/o/r/runs/1",
      },
    ]);
  });

  it("throws 401 without retrying auth failures", async () => {
    const unauthorized: Response = {
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: () => Promise.resolve({}),
    } as unknown as Response;
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(unauthorized));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listGithubWorkflows("token", "o", "r")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces rate limits classified", async () => {
    const limited: Response = {
      ok: false,
      status: 403,
      headers: {
        get: (name: string) => (name === "x-ratelimit-remaining" ? "0" : null),
      },
      json: () => Promise.resolve({}),
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(limited)));

    await expect(listGithubWorkflowRuns("token", "o", "r")).rejects.toMatchObject({
      status: 429,
      rateLimited: true,
    });
  });

  it("retries transient 5xx failures", async () => {
    const failing: Response = {
      ok: false,
      status: 502,
      headers: { get: () => null },
      json: () => Promise.resolve({}),
    } as unknown as Response;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(failing))
      .mockImplementation(() => okJson({ workflows: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listGithubWorkflows("token", "o", "r")).resolves.toEqual([]);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
