CREATE TABLE "issue_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
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
CREATE TABLE "issue_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"github_id" varchar(255) NOT NULL,
	"author_login" varchar(255),
	"body" text,
	"github_created_at" timestamp,
	"github_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_commit_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"commit_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"evidence" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_pr_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"relation" varchar(20) NOT NULL,
	"evidence" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"github_id" varchar(255) NOT NULL,
	"number" integer NOT NULL,
	"title" varchar(500),
	"body" text,
	"state" varchar(20) DEFAULT 'open' NOT NULL,
	"state_reason" varchar(50),
	"author_login" varchar(255),
	"author_github_id" varchar(255),
	"author_association" varchar(50),
	"html_url" text,
	"locked" boolean DEFAULT false NOT NULL,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"labels" json,
	"milestone_number" integer,
	"milestone_title" varchar(255),
	"milestone_state" varchar(20),
	"assignees" json,
	"github_created_at" timestamp,
	"github_updated_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "issue_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_analyses" ADD CONSTRAINT "issue_analyses_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_analyses" ADD CONSTRAINT "issue_analyses_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_commit_links" ADD CONSTRAINT "issue_commit_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_commit_links" ADD CONSTRAINT "issue_commit_links_commit_id_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_commit_links" ADD CONSTRAINT "issue_commit_links_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_pr_links" ADD CONSTRAINT "issue_pr_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_pr_links" ADD CONSTRAINT "issue_pr_links_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_pr_links" ADD CONSTRAINT "issue_pr_links_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_analyses_issue_fingerprint_idx" ON "issue_analyses" USING btree ("issue_id","evidence_fingerprint");--> statement-breakpoint
CREATE INDEX "issue_analyses_repo_idx" ON "issue_analyses" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_comments_issue_github_idx" ON "issue_comments" USING btree ("issue_id","github_id");--> statement-breakpoint
CREATE INDEX "issue_comments_issue_idx" ON "issue_comments" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_comments_repo_idx" ON "issue_comments" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_commit_links_issue_commit_idx" ON "issue_commit_links" USING btree ("issue_id","commit_id");--> statement-breakpoint
CREATE INDEX "issue_commit_links_issue_idx" ON "issue_commit_links" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_pr_links_issue_pr_relation_idx" ON "issue_pr_links" USING btree ("issue_id","pull_request_id","relation");--> statement-breakpoint
CREATE INDEX "issue_pr_links_issue_idx" ON "issue_pr_links" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_pr_links_pr_idx" ON "issue_pr_links" USING btree ("pull_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_repo_github_idx" ON "issues" USING btree ("repository_id","github_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_repo_number_idx" ON "issues" USING btree ("repository_id","number");--> statement-breakpoint
CREATE INDEX "issues_repo_idx" ON "issues" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "issues_repo_state_idx" ON "issues" USING btree ("repository_id","state");--> statement-breakpoint
CREATE INDEX "issues_repo_updated_idx" ON "issues" USING btree ("repository_id","github_updated_at");