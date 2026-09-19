import { describe, it, expect, vi, afterEach } from "vitest";
import {
  GITHUB_REQUEST_TIMEOUT_MS,
  GithubApiError,
  fetchGithubRepoMetadata,
} from "../github-provider.js";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  };
}

describe("GitHub transport hardening", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bounds every request with an abort timeout", () => {
    expect(GITHUB_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(GITHUB_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it("passes an abort signal to fetch", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(
        jsonResponse({
          id: 1,
          owner: { login: "o" },
          name: "r",
          full_name: "o/r",
          description: null,
          private: false,
          default_branch: "main",
          html_url: "https://github.com/o/r",
          archived: false,
          fork: false,
          updated_at: null,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const meta = await fetchGithubRepoMetadata("token", "o", "r");
    expect(meta.fullName).toBe("o/r");
  });

  it("classifies aborted/hung requests as retryable network failures", async () => {
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGithubRepoMetadata("token", "o", "r")).rejects.toMatchObject({
      status: 0,
    });
    // Aborts retry with backoff (3 attempts total), then surface status 0.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never retries 422 invalid-request failures", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({}, 422)));
    vi.stubGlobal("fetch", fetchMock);

    const err = await fetchGithubRepoMetadata("token", "o", "r").catch((e) => e);
    expect(err).toBeInstanceOf(GithubApiError);
    expect(err.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
