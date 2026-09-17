CREATE TABLE "chapters" (
	"id" serial PRIMARY KEY NOT NULL,
	"story_id" integer NOT NULL,
	"chapter_number" integer NOT NULL,
	"act_name" text NOT NULL,
	"title" text NOT NULL,
	"goal" text,
	"content" text,
	"word_count" integer DEFAULT 0,
	"speaker_tags" jsonb,
	"audio_url" text,
	"audio_duration_sec" numeric,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"story_id" integer,
	"chapter_id" integer,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speakers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'omnivoice' NOT NULL,
	"voice_id" text,
	"ref_audio_path" text,
	"prompt_text" text,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "speakers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"target_duration_minutes" integer DEFAULT 150,
	"total_words" integer DEFAULT 0,
	"topic_matrix" jsonb,
	"master_blueprint" jsonb,
	"thumbnail_prompt" text,
	"thumbnail_url" text,
	"final_audio_url" text,
	"final_video_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;