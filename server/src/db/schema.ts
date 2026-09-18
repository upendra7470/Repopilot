import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
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
