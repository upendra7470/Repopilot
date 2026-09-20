CREATE TABLE "ask_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"question_hash" varchar(64) NOT NULL,
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
ALTER TABLE "ask_analyses" ADD CONSTRAINT "ask_analyses_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ask_analyses_repo_question_fingerprint_idx" ON "ask_analyses" USING btree ("repository_id","question_hash","evidence_fingerprint");--> statement-breakpoint
CREATE INDEX "ask_analyses_repo_idx" ON "ask_analyses" USING btree ("repository_id");