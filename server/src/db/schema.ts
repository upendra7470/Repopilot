import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

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
