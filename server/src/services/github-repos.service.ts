import {
  getGithubCredential,
} from "./credential-store.js";
import {
  getGithubRepository,
  listGithubRepositories,
  GithubApiError,
  type GithubRepository,
} from "./github-provider.js";
import {
  createRepository,
  getRepositoryByFullName,
  getRepositoryByGithubId,
  getUserRepositories,
  linkUserRepository,
  updateRepository,
  userHasRepositoryAccess,
} from "./repository.service.js";
import { getLogger } from "../utils/logger.js";

/** Thrown when the user already connected the repository (→ 409). */
export class AlreadyConnectedError extends Error {
  readonly repositoryId: string;

  constructor(repositoryId: string) {
    super("Repository already connected");
    this.name = "AlreadyConnectedError";
    this.repositoryId = repositoryId;
  }
}

export interface DiscoveryOptions {
  query?: string;
  page?: number;
  perPage?: number;
}

export interface DiscoveryPage {
  data: Array<GithubRepository & { connected: boolean }>;
  pagination: { page: number; perPage: number; total: number };
}

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 50;

async function requireCredential(userId: string): Promise<string> {
  const credential = await getGithubCredential(userId);
  if (!credential) {
    // Session is valid but no GitHub credential is stored (e.g. cleared or
    // predates credential storage) — the user must sign in with GitHub again.
    throw new GithubApiError(401, "GitHub credential missing");
  }
  return credential;
}

/**
 * Discover repositories accessible to the authenticated GitHub user.
 *
 * Bounded server-side: at most MAX_DISCOVERY_REPOS are pulled from GitHub,
 * filtered by query, annotated with this user's connection state, and
 * paginated explicitly. The access token never leaves the server.
 */
export async function discoverRepositories(
  userId: string,
  options: DiscoveryOptions = {},
): Promise<DiscoveryPage> {
  const logger = getLogger();
  const credential = await requireCredential(userId);

  const page = Math.max(1, Math.floor(options.page ?? DEFAULT_PAGE));
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, Math.floor(options.perPage ?? DEFAULT_PER_PAGE)),
  );
  const query = (options.query ?? "").trim().toLowerCase();

  logger.debug({ userId, page, perPage }, "Discovering GitHub repositories");
  const accessible = await listGithubRepositories(credential);

  const filtered = query
    ? accessible.filter(
        (repo) =>
          repo.fullName.toLowerCase().includes(query) ||
          repo.name.toLowerCase().includes(query) ||
          repo.owner.toLowerCase().includes(query) ||
          (repo.description ?? "").toLowerCase().includes(query),
      )
    : accessible;

  const own = await getUserRepositories(userId);
  const connectedGithubIds = new Set(
    own.map((r) => r.githubId).filter((id): id is string => id !== null),
  );

  const total = filtered.length;
  const start = (page - 1) * perPage;
  const data = filtered
    .slice(start, start + perPage)
    .map((repo) => ({ ...repo, connected: connectedGithubIds.has(String(repo.id)) }));

  return { data, pagination: { page, perPage, total } };
}

const OWNER_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const REPO_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;

/**
 * Connect a GitHub repository for the authenticated user.
 *
 * The repository is re-fetched from GitHub with the user's own credential —
 * existence + access are verified server-side, never trusted from the
 * client. Identity is keyed by stable GitHub repository ID; the row is
 * shared when another user already connected the same repository, while the
 * user→repository link (and its uniqueness) keeps connections per-user.
 */
export async function connectRepository(
  userId: string,
  owner: string,
  name: string,
) {
  const logger = getLogger();

  if (!OWNER_PATTERN.test(owner) || !REPO_NAME_PATTERN.test(name)) {
    throw new GithubApiError(400, "Invalid repository owner or name");
  }

  const credential = await requireCredential(userId);
  const githubRepo = await getGithubRepository(credential, owner, name);

  const githubId = String(githubRepo.id);
  let record =
    (await getRepositoryByGithubId(githubId)) ??
    (await getRepositoryByFullName(githubRepo.fullName));

  if (!record) {
    record = await createRepository({
      githubId,
      owner: githubRepo.owner,
      name: githubRepo.name,
      fullName: githubRepo.fullName,
      description: githubRepo.description,
      defaultBranch: githubRepo.defaultBranch,
      isPrivate: githubRepo.isPrivate,
      htmlUrl: githubRepo.htmlUrl,
      archived: githubRepo.archived,
      fork: githubRepo.fork,
      connectionStatus: "connected",
    });
    logger.info({ userId, fullName: record.fullName }, "Repository connected");
  } else {
    // Refresh canonical metadata (names/descriptions can change on GitHub).
    const refreshed = await updateRepository(record.id, {
      fullName: githubRepo.fullName,
      description: githubRepo.description,
      defaultBranch: githubRepo.defaultBranch,
      isPrivate: githubRepo.isPrivate,
      htmlUrl: githubRepo.htmlUrl,
      archived: githubRepo.archived,
      fork: githubRepo.fork,
      connectionStatus: "connected",
    });
    record = refreshed ?? record;
  }

  if (await userHasRepositoryAccess(userId, record.id)) {
    throw new AlreadyConnectedError(record.id);
  }

  await linkUserRepository(userId, record.id, "owner");
  return record;
}
