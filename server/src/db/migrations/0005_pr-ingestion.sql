CREATE TABLE "pr_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"evidence_fingerprint" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"model" varchar(255),
	"summary" text,
	"risk_level" varchar(20),
	"payload" json,
	"error_code" varchar(100),
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pr_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"commit_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pr_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"path" text NOT NULL,
	"previous_path" text,
	"sha" varchar(100),
	"status" varchar(20),
	"additions" integer,
	"deletions" integer,
	"changes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"github_id" varchar(255) NOT NULL,
	"number" integer NOT NULL,
	"title" varchar(500),
	"body" text,
	"state" varchar(20) DEFAULT 'open' NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"merged" boolean DEFAULT false NOT NULL,
	"author_login" varchar(255),
	"author_github_id" varchar(255),
	"source_branch" varchar(255),
	"target_branch" varchar(255),
	"head_sha" varchar(40),
	"base_sha" varchar(40),
	"merge_commit_sha" varchar(40),
	"html_url" text,
	"additions" integer,
	"deletions" integer,
	"changed_files_count" integer,
	"github_created_at" timestamp,
	"github_updated_at" timestamp,
	"closed_at" timestamp,
	"merged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "pr_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_analyses" ADD CONSTRAINT "pr_analyses_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_analyses" ADD CONSTRAINT "pr_analyses_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_commits" ADD CONSTRAINT "pr_commits_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_commits" ADD CONSTRAINT "pr_commits_commit_id_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_files" ADD CONSTRAINT "pr_files_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_files" ADD CONSTRAINT "pr_files_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pr_analyses_pr_fingerprint_idx" ON "pr_analyses" USING btree ("pull_request_id","evidence_fingerprint");--> statement-breakpoint
CREATE INDEX "pr_analyses_repo_idx" ON "pr_analyses" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_commits_pr_commit_idx" ON "pr_commits" USING btree ("pull_request_id","commit_id");--> statement-breakpoint
CREATE INDEX "pr_commits_pr_idx" ON "pr_commits" USING btree ("pull_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_files_pr_path_idx" ON "pr_files" USING btree ("pull_request_id","path");--> statement-breakpoint
CREATE INDEX "pr_files_pr_idx" ON "pr_files" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "pr_files_repo_idx" ON "pr_files" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prs_repo_github_idx" ON "pull_requests" USING btree ("repository_id","github_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prs_repo_number_idx" ON "pull_requests" USING btree ("repository_id","number");--> statement-breakpoint
CREATE INDEX "prs_repo_idx" ON "pull_requests" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "prs_repo_state_idx" ON "pull_requests" USING btree ("repository_id","state");