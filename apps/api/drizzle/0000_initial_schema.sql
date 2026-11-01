CREATE TABLE "ai_analyses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_analyses_kind_valid" CHECK ("ai_analyses"."kind" in ('plot_holes', 'ideas')),
	CONSTRAINT "ai_analyses_scope_valid" CHECK ("ai_analyses"."scope" in ('document', 'project')),
	CONSTRAINT "ai_analyses_status_valid" CHECK ("ai_analyses"."status" in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "ai_analyses_model_not_empty" CHECK (char_length("ai_analyses"."model") > 0),
	CONSTRAINT "ai_analyses_input_tokens_non_negative" CHECK ("ai_analyses"."input_tokens" >= 0),
	CONSTRAINT "ai_analyses_output_tokens_non_negative" CHECK ("ai_analyses"."output_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_project_id_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "documents_title_length" CHECK (char_length("documents"."title") between 1 and 200),
	CONSTRAINT "documents_position_non_negative" CHECK ("documents"."position" >= 0),
	CONSTRAINT "documents_word_count_non_negative" CHECK ("documents"."word_count" >= 0),
	CONSTRAINT "documents_not_own_parent" CHECK ("documents"."parent_id" is distinct from "documents"."id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"format" text NOT NULL,
	"logline" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "projects_title_length" CHECK (char_length("projects"."title") between 1 and 200),
	CONSTRAINT "projects_format_valid" CHECK ("projects"."format" in ('screenplay', 'prose', 'other')),
	CONSTRAINT "projects_logline_length" CHECK ("projects"."logline" is null or char_length("projects"."logline") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "refresh_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "refresh_sessions_token_hash_format" CHECK ("refresh_sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "refresh_sessions_expires_after_created" CHECK ("refresh_sessions"."expires_at" > "refresh_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_email_length" CHECK (char_length("users"."email") between 3 and 254),
	CONSTRAINT "users_password_hash_not_empty" CHECK (char_length("users"."password_hash") > 0),
	CONSTRAINT "users_display_name_length" CHECK ("users"."display_name" is null or char_length("users"."display_name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_project_owner_fk" FOREIGN KEY ("project_id","user_id") REFERENCES "public"."projects"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_parent_same_project_fk" FOREIGN KEY ("project_id","parent_id") REFERENCES "public"."documents"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_analyses_document_id_idx" ON "ai_analyses" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ai_analyses_user_created_idx" ON "ai_analyses" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ai_analyses_project_created_idx" ON "ai_analyses" USING btree ("project_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "documents_project_parent_position_idx" ON "documents" USING btree ("project_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "projects_user_updated_idx" ON "projects" USING btree ("user_id","updated_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "refresh_sessions_user_id_idx" ON "refresh_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_sessions_family_id_idx" ON "refresh_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_sessions_expires_at_idx" ON "refresh_sessions" USING btree ("expires_at");