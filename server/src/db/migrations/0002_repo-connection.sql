ALTER TABLE "repositories" ADD COLUMN "html_url" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "fork" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "connection_status" varchar(20) DEFAULT 'connected' NOT NULL;