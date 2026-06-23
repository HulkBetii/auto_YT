CREATE TABLE "dr_episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'd1_pending' NOT NULL,
	"scene_input" jsonb,
	"visual_foundation" jsonb,
	"ambient_sound_map" jsonb,
	"track_specs" jsonb,
	"audio" jsonb,
	"suno_lock" timestamp with time zone,
	"thumbnail" jsonb,
	"yt_title" text,
	"yt_slug" text,
	"yt_description" text,
	"yt_tags" text,
	"yt_chapters" jsonb,
	"yt_pinned_comment" text,
	"yt_playlists" jsonb,
	"image_path" text,
	"loop_video_path" text,
	"final_video_path" text,
	"published_at" timestamp with time zone,
	"youtube_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dr_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer,
	"stage" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"prompt_text" text NOT NULL,
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
CREATE TABLE "dr_channel_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dr_prompt_versions" (
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
ALTER TABLE "dr_jobs" ADD CONSTRAINT "dr_jobs_episode_id_dr_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."dr_episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dr_jobs_open_episode_stage_unique" ON "dr_jobs" USING btree ("episode_id","stage") WHERE "dr_jobs"."episode_id" is not null and ("dr_jobs"."status" in ('pending', 'running') or ("dr_jobs"."status" = 'done' and "dr_jobs"."consumed_at" is null));