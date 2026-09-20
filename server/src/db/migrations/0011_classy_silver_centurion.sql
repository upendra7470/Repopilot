CREATE TABLE "user_ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(100) NOT NULL,
	"model" varchar(255) NOT NULL,
	"base_url" varchar(500),
	"api_key_encrypted" text,
	"api_key_iv" varchar(64),
	"api_key_tag" varchar(64),
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_ai_providers" ADD CONSTRAINT "user_ai_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_ai_providers_user_provider_idx" ON "user_ai_providers" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "user_ai_providers_user_idx" ON "user_ai_providers" USING btree ("user_id");