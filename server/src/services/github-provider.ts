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

  constructor(status: number, message: string, rateLimited = false) {
    super(message);
    this.name = "GithubApiError";
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

function isRateLimited(res: Response): boolean {
  return (
    res.status === 403 &&
    (res.headers.get("x-ratelimit-remaining") === "0" ||
      res.headers.get("retry-after") !== null)
  );
}

async function githubGet<T>(path: string, accessToken: string): Promise<T> {
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
      throw new GithubApiError(429, "GitHub rate limit exceeded", true);
    }
    throw new GithubApiError(res.status, `GitHub request failed (${path})`);
  }
  return (await res.json()) as T;
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
