CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"sha" varchar(40),
	"protected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commit_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commit_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"path" text NOT NULL,
	"sha" varchar(100),
	"status" varchar(20),
	"additions" integer,
	"deletions" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"sha" varchar(40) NOT NULL,
	"message" text,
	"author_name" varchar(255),
	"author_email" varchar(255),
	"author_login" varchar(255),
	"author_github_id" varchar(255),
	"committer_name" varchar(255),
	"committer_email" varchar(255),
	"committer_login" varchar(255),
	"contributor_id" uuid,
	"authored_at" timestamp,
	"committed_at" timestamp,
	"url" text,
	"parent_shas" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"github_id" varchar(255),
	"login" varchar(255) NOT NULL,
	"name" varchar(255),
	"email" varchar(255),
	"avatar_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"ref" varchar(255) NOT NULL,
	"path" text NOT NULL,
	"sha" varchar(100),
	"type" varchar(20),
	"size" integer,
	"mode" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"stage" varchar(50),
	"error_code" varchar(100),
	"error_message" text,
	"branch_count" integer DEFAULT 0 NOT NULL,
	"commit_count" integer DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"contributor_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "sync_status" varchar(20) DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "last_successful_sync_at" timestamp;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commit_files" ADD CONSTRAINT "commit_files_commit_id_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commit_files" ADD CONSTRAINT "commit_files_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_repo_name_idx" ON "branches" USING btree ("repository_id","name");--> statement-breakpoint
CREATE INDEX "branches_repo_idx" ON "branches" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commit_files_commit_path_idx" ON "commit_files" USING btree ("commit_id","path");--> statement-breakpoint
CREATE INDEX "commit_files_commit_idx" ON "commit_files" USING btree ("commit_id");--> statement-breakpoint
CREATE INDEX "commit_files_repo_idx" ON "commit_files" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commits_repo_sha_idx" ON "commits" USING btree ("repository_id","sha");--> statement-breakpoint
CREATE INDEX "commits_repo_idx" ON "commits" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "commits_contributor_idx" ON "commits" USING btree ("contributor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contributors_repo_github_idx" ON "contributors" USING btree ("repository_id","github_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contributors_repo_login_idx" ON "contributors" USING btree ("repository_id","login");--> statement-breakpoint
CREATE INDEX "contributors_repo_idx" ON "contributors" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "files_repo_ref_path_idx" ON "files" USING btree ("repository_id","ref","path");--> statement-breakpoint
CREATE INDEX "files_repo_idx" ON "files" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "sync_runs_repo_idx" ON "sync_runs" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_one_running_idx" ON "sync_runs" USING btree ("repository_id") WHERE "status" = 'running';
