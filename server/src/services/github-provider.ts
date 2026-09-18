/**
 * Minimal GitHub identity provider seam.
 *
 * Only the user-profile endpoints are used — no repository, commit, PR, or
 * webhook access (those belong to later phases). Kept in its own module so
 * automated tests can replace it with deterministic doubles instead of
 * depending on a real interactive GitHub login.
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
