CREATE TABLE "ko_channel_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ko_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"section_id" integer,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"model_label" text NOT NULL,
	"effort" text NOT NULL,
	"prompt_text" text NOT NULL,
	"prompt_version_id" integer NOT NULL,
	"prompt_snapshot" text NOT NULL,
	"attachment_path" text,
	"validation_attempt" integer DEFAULT 0 NOT NULL,
	"result" text,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ko_prompt_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt_key" text NOT NULL,
	"version" integer NOT NULL,
	"template" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" text DEFAULT 'manual' NOT NULL,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ko_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"section_index" integer NOT NULL,
	"kind" text NOT NULL,
	"outline_data" jsonb NOT NULL,
	"body" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"validation_errors" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ko_videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"source_video_id" text,
	"source_title" text,
	"transcript_job_id" text,
	"transcript_language" text,
	"transcript_language_confidence" text,
	"transcript_text" text,
	"transcript_path" text,
	"transcript_hash" text,
	"status" text DEFAULT 'transcript_pending' NOT NULL,
	"outline" jsonb,
	"conversation_url" text,
	"final_script" text,
	"final_script_path" text,
	"outline_prompt_version_id" integer NOT NULL,
	"section_prompt_version_id" integer NOT NULL,
	"current_section_index" integer,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ko_jobs" ADD CONSTRAINT "ko_jobs_video_id_ko_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."ko_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ko_jobs" ADD CONSTRAINT "ko_jobs_section_id_ko_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."ko_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ko_jobs" ADD CONSTRAINT "ko_jobs_prompt_version_id_ko_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."ko_prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ko_sections" ADD CONSTRAINT "ko_sections_video_id_ko_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."ko_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ko_videos" ADD CONSTRAINT "ko_videos_outline_prompt_version_id_ko_prompt_versions_id_fk" FOREIGN KEY ("outline_prompt_version_id") REFERENCES "public"."ko_prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ko_videos" ADD CONSTRAINT "ko_videos_section_prompt_version_id_ko_prompt_versions_id_fk" FOREIGN KEY ("section_prompt_version_id") REFERENCES "public"."ko_prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ko_jobs_open_work_unique" ON "ko_jobs" USING btree ("video_id","kind",coalesce("section_id", 0),"validation_attempt") WHERE "ko_jobs"."status" in ('pending', 'running') or ("ko_jobs"."status" = 'done' and "ko_jobs"."consumed_at" is null);--> statement-breakpoint
CREATE INDEX "ko_jobs_queue_idx" ON "ko_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ko_prompt_versions_key_version_unique" ON "ko_prompt_versions" USING btree ("prompt_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "ko_prompt_versions_one_active" ON "ko_prompt_versions" USING btree ("prompt_key") WHERE "ko_prompt_versions"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "ko_sections_video_index_unique" ON "ko_sections" USING btree ("video_id","section_index");--> statement-breakpoint
CREATE INDEX "ko_sections_video_status_idx" ON "ko_sections" USING btree ("video_id","status");--> statement-breakpoint
CREATE INDEX "ko_videos_status_idx" ON "ko_videos" USING btree ("status");