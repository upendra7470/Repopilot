CREATE TABLE "ci_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"evidence_fingerprint" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"model" varchar(255),
	"summary" text,
	"assessment" varchar(20),
	"payload" json,
	"error_code" varchar(100),
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ci_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"github_id" varchar(255) NOT NULL,
	"name" varchar(255),
	"status" varchar(30),
	"conclusion" varchar(30),
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration_sec" integer,
	"html_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ci_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"github_id" varchar(255) NOT NULL,
	"run_number" integer,
	"name" varchar(255),
	"event" varchar(50),
	"status" varchar(30),
	"conclusion" varchar(30),
	"head_branch" varchar(255),
	"head_sha" varchar(40),
	"run_attempt" integer,
	"actor_login" varchar(255),
	"pr_numbers" json,
	"html_url" text,
	"duration_sec" integer,
	"github_created_at" timestamp,
	"github_updated_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ci_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"github_id" varchar(255) NOT NULL,
	"name" varchar(255),
	"path" text,
	"state" varchar(30),
	"badge_url" text,
	"html_url" text,
	"github_created_at" timestamp,
	"github_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "workflow_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "workflow_run_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_analyses" ADD CONSTRAINT "ci_analyses_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ci_analyses" ADD CONSTRAINT "ci_analyses_run_id_ci_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ci_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ci_jobs" ADD CONSTRAINT "ci_jobs_run_id_ci_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ci_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ci_jobs" ADD CONSTRAINT "ci_jobs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_workflow_id_ci_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."ci_workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ci_workflows" ADD CONSTRAINT "ci_workflows_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_analyses_run_fingerprint_idx" ON "ci_analyses" USING btree ("run_id","evidence_fingerprint");--> statement-breakpoint
CREATE INDEX "ci_analyses_repo_idx" ON "ci_analyses" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_jobs_run_github_idx" ON "ci_jobs" USING btree ("run_id","github_id");--> statement-breakpoint
CREATE INDEX "ci_jobs_run_idx" ON "ci_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ci_jobs_repo_idx" ON "ci_jobs" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_repo_github_idx" ON "ci_runs" USING btree ("repository_id","github_id");--> statement-breakpoint
CREATE INDEX "ci_runs_repo_idx" ON "ci_runs" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "ci_runs_repo_workflow_idx" ON "ci_runs" USING btree ("repository_id","workflow_id");--> statement-breakpoint
CREATE INDEX "ci_runs_repo_sha_idx" ON "ci_runs" USING btree ("repository_id","head_sha");--> statement-breakpoint
CREATE INDEX "ci_runs_repo_branch_idx" ON "ci_runs" USING btree ("repository_id","head_branch");--> statement-breakpoint
CREATE INDEX "ci_runs_repo_status_idx" ON "ci_runs" USING btree ("repository_id","status");--> statement-breakpoint
CREATE INDEX "ci_runs_repo_conclusion_idx" ON "ci_runs" USING btree ("repository_id","conclusion");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_workflows_repo_github_idx" ON "ci_workflows" USING btree ("repository_id","github_id");--> statement-breakpoint
CREATE INDEX "ci_workflows_repo_idx" ON "ci_workflows" USING btree ("repository_id");