CREATE TABLE "study_audio_weeks" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"track_manifest" jsonb,
	"total_duration_sec" integer,
	"rights_verified_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_audio_weeks_week_number_unique" UNIQUE("week_number"),
	CONSTRAINT "study_audio_weeks_week_number_check" CHECK ("study_audio_weeks"."week_number" BETWEEN 1 AND 15),
	CONSTRAINT "study_audio_weeks_status_check" CHECK ("study_audio_weeks"."status" IN ('draft', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "study_daily_videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_number" integer NOT NULL,
	"week_id" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"footage_manifest" jsonb,
	"duration_sec" integer,
	"input_signature" text,
	"final_video_path" text,
	"error_message" text,
	"assembly_started_at" timestamp with time zone,
	"assembly_finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_daily_videos_day_number_unique" UNIQUE("day_number"),
	CONSTRAINT "study_daily_videos_day_number_check" CHECK ("study_daily_videos"."day_number" BETWEEN 1 AND 100),
	CONSTRAINT "study_daily_videos_status_check" CHECK ("study_daily_videos"."status" IN ('draft', 'assembling', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "study_daily_videos" ADD CONSTRAINT "study_daily_videos_week_id_study_audio_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."study_audio_weeks"("id") ON DELETE restrict ON UPDATE no action;