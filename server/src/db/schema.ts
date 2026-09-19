import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  integer,
  json,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    githubId: varchar("github_id", { length: 255 }),
    login: varchar("login", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_github_id_idx").on(table.githubId),
    uniqueIndex("users_login_idx").on(table.login),
  ],
);

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    githubId: varchar("github_id", { length: 255 }),
    owner: varchar("owner", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    fullName: text("full_name").notNull(),
    description: text("description"),
    defaultBranch: varchar("default_branch", { length: 255 })
      .default("main")
      .notNull(),
    isPrivate: boolean("is_private").default(false).notNull(),
    htmlUrl: text("html_url"),
    archived: boolean("archived").default(false).notNull(),
    fork: boolean("fork").default(false).notNull(),
    connectionStatus: varchar("connection_status", { length: 20 })
      .default("connected")
      .notNull(),
    syncStatus: varchar("sync_status", { length: 20 })
      .default("idle")
      .notNull(),
    lastSyncedAt: timestamp("last_synced_at"),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("repositories_github_id_idx").on(table.githubId),
    uniqueIndex("repositories_owner_name_idx").on(table.owner, table.name),
  ],
);

export const userRepositories = pgTable(
  "user_repositories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    repositoryId: uuid("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    role: varchar("role", { length: 50 }).default("member").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_repositories_user_repo_idx").on(
      table.userId,
      table.repositoryId,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
export type UserRepository = typeof userRepositories.$inferSelect;
export type NewUserRepository = typeof userRepositories.$inferInsert;

/**
 * Server-managed authenticated sessions.
 *
 * The session cookie holds a random token; only its SHA-256 hash is stored
 * here, so a database read alone never yields a usable cookie value.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_idx").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
  ],
);

/**
 * Provider credentials for future server-side GitHub API access (Phase 4+).
 *
 * The access token is stored AES-256-GCM encrypted (see CredentialStore),
 * never in plain text, and is never exposed through API responses.
 * `providerAccountId` is the stable GitHub numeric user ID.
 */
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    provider: varchar("provider", { length: 50 }).default("github").notNull(),
    providerAccountId: varchar("provider_account_id", {
      length: 255,
    }).notNull(),
    accessTokenEncrypted: text("access_token_encrypted"),
    accessTokenIv: varchar("access_token_iv", { length: 64 }),
    accessTokenTag: varchar("access_token_tag", { length: 64 }),
    scope: varchar("scope", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("oauth_accounts_provider_account_idx").on(
      table.provider,
      table.providerAccountId,
    ),
    uniqueIndex("oauth_accounts_user_provider_idx").on(
      table.userId,
      table.provider,
    ),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type NewOAuthAccount = typeof oauthAccounts.$inferInsert;

/**
 * Branch state snapshot (Phase 5 ingestion).
 *
 * Branches are mutable pointers: re-sync updates the row in place keyed by
 * (repositoryId, name), never inserting duplicates.
 */
export const branches = pgTable(
  "branches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    sha: varchar("sha", { length: 40 }),
    protected: boolean("protected").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("branches_repo_name_idx").on(table.repositoryId, table.name),
    index("branches_repo_idx").on(table.repositoryId),
  ],
);

/**
 * Contributors derived from repository activity (Phase 5 ingestion).
 *
 * Identity is keyed by stable GitHub user ID when available, falling back
 * to login. Unknown/anonymous authors are represented on the commit row
 * itself (name/email) without a contributor row when no login exists.
 */
export const contributors = pgTable(
  "contributors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    githubId: varchar("github_id", { length: 255 }),
    login: varchar("login", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("contributors_repo_github_idx").on(
      table.repositoryId,
      table.githubId,
    ),
    uniqueIndex("contributors_repo_login_idx").on(
      table.repositoryId,
      table.login,
    ),
    index("contributors_repo_idx").on(table.repositoryId),
  ],
);

/**
 * Commit history (Phase 5 ingestion). The GitHub commit SHA is the stable
 * external identity; (repositoryId, sha) uniqueness makes re-syncs safe.
 */
export const commits = pgTable(
  "commits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    sha: varchar("sha", { length: 40 }).notNull(),
    message: text("message"),
    authorName: varchar("author_name", { length: 255 }),
    authorEmail: varchar("author_email", { length: 255 }),
    authorLogin: varchar("author_login", { length: 255 }),
    authorGithubId: varchar("author_github_id", { length: 255 }),
    committerName: varchar("committer_name", { length: 255 }),
    committerEmail: varchar("committer_email", { length: 255 }),
    committerLogin: varchar("committer_login", { length: 255 }),
    contributorId: uuid("contributor_id").references(() => contributors.id, {
      onDelete: "set null",
    }),
    authoredAt: timestamp("authored_at"),
    committedAt: timestamp("committed_at"),
    url: text("url"),
    parentShas: json("parent_shas").$type<string[]>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("commits_repo_sha_idx").on(table.repositoryId, table.sha),
    index("commits_repo_idx").on(table.repositoryId),
    index("commits_contributor_idx").on(table.contributorId),
  ],
);

/**
 * File-tree snapshot per ref (Phase 5 ingestion). Current structure only;
 * history is reconstructed through commit_files. Metadata only — file
 * contents are never fetched or stored.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    ref: varchar("ref", { length: 255 }).notNull(),
    path: text("path").notNull(),
    sha: varchar("sha", { length: 100 }),
    type: varchar("type", { length: 20 }),
    size: integer("size"),
    mode: varchar("mode", { length: 20 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("files_repo_ref_path_idx").on(
      table.repositoryId,
      table.ref,
      table.path,
    ),
    index("files_repo_idx").on(table.repositoryId),
    // The files table is a *file* snapshot: only blobs are persisted.
    // Directory/submodule entries from the Git Trees API are filtered
    // during sync (directory structure is implicit in blob paths).
    check("files_blob_only", sql`${table.type} = 'blob'`),
  ],
);

/**
 * Commit ↔ changed-file relationship (Phase 5 ingestion). Metadata only:
 * status plus line-change counts from the commit detail endpoint. No diffs,
 * no patches, no source code.
 */
export const commitFiles = pgTable(
  "commit_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commitId: uuid("commit_id")
      .references(() => commits.id, { onDelete: "cascade" })
      .notNull(),
    repositoryId: uuid("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    path: text("path").notNull(),
    sha: varchar("sha", { length: 100 }),
    status: varchar("status", { length: 20 }),
    additions: integer("additions"),
    deletions: integer("deletions"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("commit_files_commit_path_idx").on(table.commitId, table.path),
    index("commit_files_commit_idx").on(table.commitId),
    index("commit_files_repo_idx").on(table.repositoryId),
  ],
);

/**
 * Sync execution record (Phase 5 ingestion). Exactly one RUNNING row per
 * repository is enforced by a partial unique index (see migration SQL:
 * drizzle-kit cannot express partial unique indexes, so it is declared in
 * raw SQL alongside the generated migration).
 */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    stage: varchar("stage", { length: 50 }),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    branchCount: integer("branch_count").default(0).notNull(),
    commitCount: integer("commit_count").default(0).notNull(),
    fileCount: integer("file_count").default(0).notNull(),
    contributorCount: integer("contributor_count").default(0).notNull(),
    prCount: integer("pr_count").default(0).notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [index("sync_runs_repo_idx").on(table.repositoryId)],
);

export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
export type Contributor = typeof contributors.$inferSelect;
export type NewContributor = typeof contributors.$inferInsert;
export type Commit = typeof commits.$inferSelect;
export type NewCommit = typeof commits.$inferInsert;
export type RepoFile = typeof files.$inferSelect;
export type NewRepoFile = typeof files.$inferInsert;
export type CommitFile = typeof commitFiles.$inferSelect;
export type NewCommitFile = typeof commitFiles.$inferInsert;
export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;

/**
 * Pull requests (Phase 8 ingestion). Identity is the stable GitHub PR ID,
 * with the human-facing number unique per repository. Rows are upserted —
 * re-syncs refresh in place, never duplicate.
 */
export const pullRequests = pgTable(
  "pull_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    githubId: varchar("github_id", { length: 255 }).notNull(),
    number: integer("number").notNull(),
    title: varchar("title", { length: 500 }),
    body: text("body"),
    state: varchar("state", { length: 20 }).default("open").notNull(),
    draft: boolean("draft").default(false).notNull(),
    merged: boolean("merged").default(false).notNull(),
    authorLogin: varchar("author_login", { length: 255 }),
    authorGithubId: varchar("author_github_id", { length: 255 }),
    sourceBranch: varchar("source_branch", { length: 255 }),
    targetBranch: varchar("target_branch", { length: 255 }),
    headSha: varchar("head_sha", { length: 40 }),
    baseSha: varchar("base_sha", { length: 40 }),
    mergeCommitSha: varchar("merge_commit_sha", { length: 40 }),
    htmlUrl: text("html_url"),
    additions: integer("additions"),
    deletions: integer("deletions"),
    changedFilesCount: integer("changed_files_count"),
    githubCreatedAt: timestamp("github_created_at"),
    githubUpdatedAt: timestamp("github_updated_at"),
    closedAt: timestamp("closed_at"),
    mergedAt: timestamp("merged_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("prs_repo_github_idx").on(table.repositoryId, table.githubId),
    uniqueIndex("prs_repo_number_idx").on(table.repositoryId, table.number),
    index("prs_repo_idx").on(table.repositoryId),
    index("prs_repo_state_idx").on(table.repositoryId, table.state),
  ],
);

/**
 * PR ↔ commit links. Reuses existing commit rows (matched by SHA) — no
 * commit data is duplicated. Commits not present locally (fork-only or
 * beyond sync bounds) are simply not linked.
 */
export const prCommits = pgTable(
  "pr_commits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pullRequestId: uuid("pull_request_id")
      .references(() => pullRequests.id, { onDelete: "cascade" })
      .notNull(),
    commitId: uuid("commit_id")
      .references(() => commits.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("pr_commits_pr_commit_idx").on(
      table.pullRequestId,
      table.commitId,
    ),
    index("pr_commits_pr_idx").on(table.pullRequestId),
  ],
);

/**
 * Changed files per PR (metadata only: path, status, line counts).
 * No diffs, no patches, no source code.
 */
export const prFiles = pgTable(
  "pr_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pullRequestId: uuid("pull_request_id")
      .references(() => pullRequests.id, { onDelete: "cascade" })
      .notNull(),
    repositoryId: uuid("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    path: text("path").notNull(),
    previousPath: text("previous_path"),
    sha: varchar("sha", { length: 100 }),
    status: varchar("status", { length: 20 }),
    additions: integer("additions"),
    deletions: integer("deletions"),
    changes: integer("changes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("pr_files_pr_path_idx").on(table.pullRequestId, table.path),
    index("pr_files_pr_idx").on(table.pullRequestId),
    index("pr_files_repo_idx").on(table.repositoryId),
  ],
);

/**
 * Cached AI analyses (Phase 8). One completed analysis per evidence
 * fingerprint: identical evidence reuses the stored result instead of
 * calling the model again. Failures are recorded for observability but
 * never served as results.
 */
export const prAnalyses = pgTable(
  "pr_analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    pullRequestId: uuid("pull_request_id")
      .references(() => pullRequests.id, { onDelete: "cascade" })
      .notNull(),
    evidenceFingerprint: varchar("evidence_fingerprint", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    model: varchar("model", { length: 255 }),
    summary: text("summary"),
    riskLevel: varchar("risk_level", { length: 20 }),
    payload: json("payload").$type<Record<string, unknown>>(),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    uniqueIndex("pr_analyses_pr_fingerprint_idx").on(
      table.pullRequestId,
      table.evidenceFingerprint,
    ),
    index("pr_analyses_repo_idx").on(table.repositoryId),
  ],
);

export type PullRequest = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;
export type PrCommit = typeof prCommits.$inferSelect;
export type NewPrCommit = typeof prCommits.$inferInsert;
export type PrFile = typeof prFiles.$inferSelect;
export type NewPrFile = typeof prFiles.$inferInsert;
export type PrAnalysis = typeof prAnalyses.$inferSelect;
export type NewPrAnalysis = typeof prAnalyses.$inferInsert;
