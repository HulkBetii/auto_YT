ALTER TABLE "study_daily_videos" ADD COLUMN "preview_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "study_daily_videos" ADD COLUMN "preview_run_id" text;--> statement-breakpoint
ALTER TABLE "study_daily_videos" ADD COLUMN "preview_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_daily_videos" ADD COLUMN "preview_requested_offset_sec" double precision;--> statement-breakpoint
ALTER TABLE "study_daily_videos" ADD COLUMN "preview_actual_offset_sec" double precision;--> statement-breakpoint
ALTER TABLE "study_daily_videos" ADD COLUMN "preview_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_daily_videos" ADD COLUMN "preview_finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_daily_videos" ADD COLUMN "preview_error_message" text;--> statement-breakpoint
ALTER TABLE "study_daily_videos" ADD CONSTRAINT "study_daily_videos_preview_status_check" CHECK ("study_daily_videos"."preview_status" IN ('idle', 'rendering', 'done', 'failed'));