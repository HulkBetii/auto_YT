CREATE TABLE "ah_videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 's1_pending' NOT NULL,
	"voice_id" text,
	"topic_candidates" jsonb,
	"chosen_topic" jsonb,
	"script" text,
	"script_slug" text,
	"audio_url" text,
	"whisper_transcript" text,
	"image_prompts" text,
	"yt_title" text,
	"yt_description" text,
	"yt_tags" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ah_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer,
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
CREATE TABLE "ah_channel_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ah_prompt_versions" (
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
ALTER TABLE "ah_jobs" ADD CONSTRAINT "ah_jobs_video_id_ah_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."ah_videos"("id") ON DELETE no action ON UPDATE no action;