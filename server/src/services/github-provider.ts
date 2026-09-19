/**
 * GitHub API provider seam (identity + repository discovery).
 *
 * Phase 3 established identity via the user-profile endpoints; Phase 4 adds
 * read-only repository discovery (`GET /user/repos`, `GET /repos/{o}/{r}`).
 * No ingestion endpoints (commits, branches, files, PRs, webhooks) are used
 * here — those belong to later phases. Kept in its own module so automated
 * tests can replace it with deterministic doubles instead of depending on
 * real GitHub access.
 *
 * Note on scopes: with the Phase 3 identity scopes (`read:user`,
 * `user:email`), discovery returns the public repositories the token can
 * see. Private-repository discovery requires the `repo` scope, which is a
 * deliberate future expansion (re-authorize with wider scopes).
 */
export interface GithubProfile {
  /** Stable GitHub numeric user ID. */
  id: number;
  /** GitHub username (may change; never used as the identity key). */
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

interface GithubUserResponse {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface GithubEmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
}

function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "RepoPilot",
    Authorization: `Bearer ${accessToken}`,
  };
}

export async function fetchGithubPrimaryEmail(
  accessToken: string,
): Promise<string | null> {
  const res = await fetch("https://api.github.com/user/emails", {
    headers: githubHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(
      `GitHub email request failed with status ${res.status}`,
    );
  }
  const emails = (await res.json()) as GithubEmailResponse[];
  const primary = emails.find((e) => e.primary && e.verified) ??
    emails.find((e) => e.verified) ??
    emails[0];
  return primary?.email ?? null;
}

/** Classified GitHub API failure (never carries the token). */
export class GithubApiError extends Error {
  readonly status: number;
  readonly rateLimited: boolean;
  /** Retry-After hint in milliseconds, when GitHub provided one. */
  readonly retryAfterMs: number | null;

  constructor(
    status: number,
    message: string,
    rateLimited = false,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "GithubApiError";
    this.status = status;
    this.rateLimited = rateLimited;
    this.retryAfterMs = retryAfterMs;
  }
}

function isRateLimited(res: Response): boolean {
  return (
    res.status === 403 &&
    (res.headers.get("x-ratelimit-remaining") === "0" ||
      res.headers.get("retry-after") !== null)
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 429 || (status >= 500 && status < 600);
}

/**
 * Retry transient GitHub failures (network errors, rate limits, 5xx) with
 * backoff. Never retries auth/permission/client errors (401/403/404/422).
 * Honors Retry-After on 429, capped at 60s. Max 3 attempts total.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      const retryable =
        err instanceof GithubApiError && isRetryableStatus(err.status);
      if (!retryable || attempt >= 3) {
        throw err;
      }
      const retryAfter =
        err instanceof GithubApiError && err.retryAfterMs !== null
          ? Math.min(err.retryAfterMs, 60_000)
          : 500 * attempt;
      await sleep(retryAfter);
    }
  }
}

async function githubGet<T>(path: string, accessToken: string): Promise<T> {
  return withRetry(async () => {
    let res: Response;
    try {
      res = await fetch(`https://api.github.com${path}`, {
        headers: githubHeaders(accessToken),
      });
    } catch (err) {
      throw new GithubApiError(
        0,
        `GitHub request failed: ${err instanceof Error ? err.message : "network error"}`,
      );
    }
    if (!res.ok) {
      if (res.status === 401) {
        throw new GithubApiError(401, "GitHub credential rejected", false);
      }
      if (isRateLimited(res)) {
        const retryAfter = res.headers.get("retry-after");
        const retryAfterMs =
          retryAfter !== null && Number.isFinite(Number(retryAfter))
            ? Number(retryAfter) * 1000
            : null;
        throw new GithubApiError(
          429,
          "GitHub rate limit exceeded",
          true,
          retryAfterMs,
        );
      }
      throw new GithubApiError(res.status, `GitHub request failed (${path})`);
    }
    return (await res.json()) as T;
  });
}

/**
 * Fetch a paginated GitHub list endpoint until a short page, an empty page,
 * or maxPages is reached. Never loops unboundedly.
 */
async function githubGetAll<T>(
  buildPath: (page: number, perPage: number) => string,
  accessToken: string,
  options: { perPage?: number; maxPages?: number } = {},
): Promise<T[]> {
  const perPage = options.perPage ?? 100;
  const maxPages = options.maxPages ?? 1;
  const collected: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await githubGet<T[]>(buildPath(page, perPage), accessToken);
    collected.push(...batch);
    if (batch.length < perPage) {
      break;
    }
  }
  return collected;
}

/** Repository metadata kept for selection (nothing more is persisted). */
export interface GithubRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  htmlUrl: string;
  archived: boolean;
  fork: boolean;
  permissions: { admin: boolean; push: boolean; pull: boolean };
  updatedAt: string | null;
}

interface GithubRepoResponse {
  id: number;
  owner: { login: string };
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  html_url: string;
  archived: boolean;
  fork: boolean;
  permissions?: { admin: boolean; push: boolean; pull: boolean };
  updated_at: string | null;
}

function toGithubRepository(data: GithubRepoResponse): GithubRepository {
  return {
    id: data.id,
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    description: data.description ?? null,
    isPrivate: data.private,
    defaultBranch: data.default_branch || "main",
    htmlUrl: data.html_url,
    archived: data.archived,
    fork: data.fork,
    permissions: {
      admin: data.permissions?.admin ?? false,
      push: data.permissions?.push ?? false,
      pull: data.permissions?.pull ?? true,
    },
    updatedAt: data.updated_at ?? null,
  };
}

/** Hard bound: at most this many repos are pulled from GitHub per request. */
export const MAX_DISCOVERY_REPOS = 300;
const GITHUB_PAGE_SIZE = 100;

/**
 * List repositories accessible to the token, bounded and most-recent first.
 * Pulls up to MAX_DISCOVERY_REPOS via `GET /user/repos` pagination.
 */
export async function listGithubRepositories(
  accessToken: string,
): Promise<GithubRepository[]> {
  const collected: GithubRepository[] = [];
  const maxPages = Math.ceil(MAX_DISCOVERY_REPOS / GITHUB_PAGE_SIZE);

  for (let page = 1; page <= maxPages; page++) {
    const batch = await githubGet<GithubRepoResponse[]>(
      `/user/repos?per_page=${GITHUB_PAGE_SIZE}&page=${page}&sort=updated&direction=desc`,
      accessToken,
    );
    for (const item of batch) {
      collected.push(toGithubRepository(item));
      if (collected.length >= MAX_DISCOVERY_REPOS) {
        return collected;
      }
    }
    if (batch.length < GITHUB_PAGE_SIZE) {
      break;
    }
  }
  return collected;
}

/**
 * Fetch a single repository as visible to the token. A 404 here means
 * "not accessible to this credential" (missing, private, or forbidden) —
 * callers map it to a privacy-preserving 404 without leaking which.
 */
export async function getGithubRepository(
  accessToken: string,
  owner: string,
  name: string,
): Promise<GithubRepository> {
  const data = await githubGet<GithubRepoResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    accessToken,
  );
  return toGithubRepository(data);
}

/** Repository metadata for sync (subset of GET /repos/{owner}/{repo}). */
export interface GithubRepoMetadata {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  htmlUrl: string;
  archived: boolean;
  fork: boolean;
  updatedAt: string | null;
}

export async function fetchGithubRepoMetadata(
  accessToken: string,
  owner: string,
  name: string,
): Promise<GithubRepoMetadata> {
  const data = await githubGet<
    GithubRepoResponse & { updated_at: string | null }
  >(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    accessToken,
  );
  return {
    id: data.id,
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    description: data.description ?? null,
    isPrivate: data.private,
    defaultBranch: data.default_branch || "main",
    htmlUrl: data.html_url,
    archived: data.archived,
    fork: data.fork,
    updatedAt: data.updated_at ?? null,
  };
}

/** Branch entry from GET /repos/{owner}/{repo}/branches. */
export interface GithubBranch {
  name: string;
  sha: string | null;
  isProtected: boolean;
}

export async function listGithubBranches(
  accessToken: string,
  owner: string,
  name: string,
  maxPages = 2,
): Promise<GithubBranch[]> {
  const items = await githubGetAll<{
    name: string;
    commit: { sha: string };
    protected?: boolean;
  }>(
    (page, perPage) =>
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches?per_page=${perPage}&page=${page}`,
    accessToken,
    { perPage: 100, maxPages },
  );
  return items.map((item) => ({
    name: item.name,
    sha: item.commit?.sha ?? null,
    isProtected: item.protected ?? false,
  }));
}

/** GitHub user identity as embedded in commit payloads (often partial). */
export interface GithubCommitPerson {
  name: string | null;
  email: string | null;
  login: string | null;
  githubId: number | null;
  avatarUrl: string | null;
  date: string | null;
}

function toCommitPerson(
  commitSide: { name?: string | null; email?: string | null; date?: string | null } | null,
  userSide: {
    login?: string;
    id?: number;
    avatar_url?: string | null;
  } | null,
): GithubCommitPerson {
  return {
    name: commitSide?.name ?? userSide?.login ?? null,
    email: commitSide?.email ?? null,
    login: userSide?.login ?? null,
    githubId: typeof userSide?.id === "number" ? userSide.id : null,
    avatarUrl: userSide?.avatar_url ?? null,
    date: commitSide?.date ?? null,
  };
}

/** Commit entry from GET /repos/{owner}/{repo}/commits. */
export interface GithubCommit {
  sha: string;
  message: string | null;
  author: GithubCommitPerson;
  committer: GithubCommitPerson;
  url: string | null;
  parents: string[];
}

interface GithubCommitResponse {
  sha: string;
  commit: {
    message: string;
    author: { name?: string | null; email?: string | null; date?: string | null } | null;
    committer: { name?: string | null; email?: string | null; date?: string | null } | null;
  };
  author: { login?: string; id?: number; avatar_url?: string | null } | null;
  committer: { login?: string; id?: number; avatar_url?: string | null } | null;
  html_url?: string;
  parents?: Array<{ sha?: string }>;
}

function toGithubCommit(item: GithubCommitResponse): GithubCommit {
  return {
    sha: item.sha,
    message: item.commit?.message ?? null,
    author: toCommitPerson(item.commit?.author ?? null, item.author),
    committer: toCommitPerson(item.commit?.committer ?? null, item.committer),
    url: item.html_url ?? null,
    parents: (item.parents ?? [])
      .map((p) => p.sha)
      .filter((sha): sha is string => typeof sha === "string"),
  };
}

export async function listGithubCommits(
  accessToken: string,
  owner: string,
  name: string,
  options: { sha?: string; since?: string; maxPages?: number } = {},
): Promise<GithubCommit[]> {
  const params = new URLSearchParams({ per_page: "100", page: "1" });
  if (options.sha) params.set("sha", options.sha);
  if (options.since) params.set("since", options.since);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits`;
  const items = await githubGetAll<GithubCommitResponse>(
    (page, perPage) => {
      const query = new URLSearchParams(params);
      query.set("page", String(page));
      query.set("per_page", String(perPage));
      return `${base}?${query.toString()}`;
    },
    accessToken,
    { perPage: 100, maxPages: options.maxPages ?? 3 },
  );
  return items.map(toGithubCommit);
}

/** Single tree entry from the Git Trees API (metadata only, no contents). */
export interface GithubTreeEntry {
  path: string;
  sha: string | null;
  type: string | null;
  size: number | null;
  mode: string | null;
}

export interface GithubTree {
  truncated: boolean;
  entries: GithubTreeEntry[];
}

/**
 * Fetch the full recursive tree for a ref in ONE request
 * (GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1). Callers must
 * honor `truncated` (partial snapshot, still persisted with that caveat).
 */
export async function fetchGithubTree(
  accessToken: string,
  owner: string,
  name: string,
  sha: string,
): Promise<GithubTree> {
  const data = await githubGet<{
    truncated?: boolean;
    tree?: Array<{
      path?: string;
      sha?: string;
      type?: string;
      size?: number;
      mode?: string;
    }>;
  }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(sha)}?recursive=1`,
    accessToken,
  );
  return {
    truncated: data.truncated ?? false,
    entries: (data.tree ?? [])
      .filter((e) => typeof e.path === "string")
      .map((e) => ({
        path: e.path as string,
        sha: e.sha ?? null,
        type: e.type ?? null,
        size: typeof e.size === "number" ? e.size : null,
        mode: e.mode ?? null,
      })),
  };
}

/** Changed-file entry from GET /repos/{owner}/{repo}/commits/{sha}. */
export interface GithubCommitFile {
  path: string;
  sha: string | null;
  status: string | null;
  additions: number | null;
  deletions: number | null;
}

/**
 * Commit detail for file relationships (metadata only — patch/diff is
 * deliberately NOT requested or stored).
 */
export async function fetchGithubCommitFiles(
  accessToken: string,
  owner: string,
  name: string,
  sha: string,
): Promise<GithubCommitFile[]> {
  const data = await githubGet<{
    files?: Array<{
      filename?: string;
      sha?: string;
      status?: string;
      additions?: number;
      deletions?: number;
    }>;
  }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}`,
    accessToken,
  );
  return (data.files ?? [])
    .filter((f) => typeof f.filename === "string")
    .map((f) => ({
      path: f.filename as string,
      sha: f.sha ?? null,
      status: f.status ?? null,
      additions: typeof f.additions === "number" ? f.additions : null,
      deletions: typeof f.deletions === "number" ? f.deletions : null,
    }));
}

/** Pull request identity + stats (Phase 8 ingestion, read-only). */
export interface GithubPullRequest {
  id: number;
  number: number;
  title: string | null;
  body: string | null;
  state: string;
  draft: boolean;
  merged: boolean;
  authorLogin: string | null;
  authorGithubId: number | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  headSha: string | null;
  baseSha: string | null;
  mergeCommitSha: string | null;
  htmlUrl: string | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  mergedAt: string | null;
}

interface GithubPullResponse {
  id: number;
  number: number;
  title: string | null;
  body: string | null;
  state: string;
  draft?: boolean;
  merged?: boolean;
  user: { login?: string; id?: number } | null;
  head: { ref?: string; sha?: string } | null;
  base: { ref?: string; sha?: string } | null;
  merge_commit_sha?: string | null;
  html_url?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  merged_at?: string | null;
}

function toGithubPullRequest(data: GithubPullResponse): GithubPullRequest {
  return {
    id: data.id,
    number: data.number,
    title: data.title ?? null,
    body: data.body ?? null,
    state: data.state,
    draft: data.draft ?? false,
    merged: data.merged ?? false,
    authorLogin: data.user?.login ?? null,
    authorGithubId: typeof data.user?.id === "number" ? data.user.id : null,
    sourceBranch: data.head?.ref ?? null,
    targetBranch: data.base?.ref ?? null,
    headSha: data.head?.sha ?? null,
    baseSha: data.base?.sha ?? null,
    mergeCommitSha: data.merge_commit_sha ?? null,
    htmlUrl: data.html_url ?? null,
    additions: typeof data.additions === "number" ? data.additions : null,
    deletions: typeof data.deletions === "number" ? data.deletions : null,
    changedFiles:
      typeof data.changed_files === "number" ? data.changed_files : null,
    createdAt: data.created_at ?? null,
    updatedAt: data.updated_at ?? null,
    closedAt: data.closed_at ?? null,
    mergedAt: data.merged_at ?? null,
  };
}

/**
 * List pull requests (state open|closed|all), newest first, bounded pages.
 * List items lack diff stats — fetch full detail per PR where needed.
 */
export async function listGithubPullRequests(
  accessToken: string,
  owner: string,
  name: string,
  options: { state?: string; maxPages?: number } = {},
): Promise<GithubPullRequest[]> {
  const state = options.state ?? "all";
  const items = await githubGetAll<GithubPullResponse>(
    (page, perPage) =>
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?state=${state}&sort=updated&direction=desc&per_page=${perPage}&page=${page}`,
    accessToken,
    { perPage: 50, maxPages: options.maxPages ?? 2 },
  );
  return items.map(toGithubPullRequest);
}

/** Full PR detail incl. diff stats (additions/deletions/changed files). */
export async function fetchGithubPullRequest(
  accessToken: string,
  owner: string,
  name: string,
  prNumber: number,
): Promise<GithubPullRequest> {
  const data = await githubGet<GithubPullResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${prNumber}`,
    accessToken,
  );
  return toGithubPullRequest(data);
}

/** Commits belonging to a PR (same shape as the commits list endpoint). */
export async function listGithubPullCommits(
  accessToken: string,
  owner: string,
  name: string,
  prNumber: number,
  maxPages = 2,
): Promise<GithubCommit[]> {
  const items = await githubGetAll<GithubCommitResponse>(
    (page, perPage) =>
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${prNumber}/commits?per_page=${perPage}&page=${page}`,
    accessToken,
    { perPage: 100, maxPages },
  );
  return items.map(toGithubCommit);
}

/** Changed-file metadata for a PR (no diffs, no patches). */
export interface GithubPullFile {
  path: string;
  previousPath: string | null;
  sha: string | null;
  status: string | null;
  additions: number | null;
  deletions: number | null;
  changes: number | null;
}

export async function listGithubPullFiles(
  accessToken: string,
  owner: string,
  name: string,
  prNumber: number,
  maxPages = 1,
): Promise<GithubPullFile[]> {
  const items = await githubGetAll<{
    filename?: string;
    previous_filename?: string;
    sha?: string;
    status?: string;
    additions?: number;
    deletions?: number;
    changes?: number;
  }>(
    (page, perPage) =>
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${prNumber}/files?per_page=${perPage}&page=${page}`,
    accessToken,
    { perPage: 100, maxPages },
  );
  return items
    .filter((f) => typeof f.filename === "string")
    .map((f) => ({
      path: f.filename as string,
      previousPath: f.previous_filename ?? null,
      sha: f.sha ?? null,
      status: f.status ?? null,
      additions: typeof f.additions === "number" ? f.additions : null,
      deletions: typeof f.deletions === "number" ? f.deletions : null,
      changes: typeof f.changes === "number" ? f.changes : null,
    }));
}

/**
 * Fetch the authenticated GitHub user's profile. The access token is only
 * ever sent in the Authorization header — never logged, never in URLs.
 */
export async function fetchGithubProfile(
  accessToken: string,
): Promise<GithubProfile> {
  const res = await fetch("https://api.github.com/user", {
    headers: githubHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(
      `GitHub profile request failed with status ${res.status}`,
    );
  }
  const data = (await res.json()) as GithubUserResponse;
  let email = data.email ?? null;
  if (!email) {
    email = await fetchGithubPrimaryEmail(accessToken);
  }
  return {
    id: data.id,
    login: data.login,
    name: data.name ?? null,
    email,
    avatarUrl: data.avatar_url ?? null,
  };
}
