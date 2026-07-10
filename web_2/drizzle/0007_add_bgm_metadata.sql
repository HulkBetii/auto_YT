ALTER TABLE "ah_videos" ADD COLUMN IF NOT EXISTS "bgm_status" text NOT NULL DEFAULT 'not_started';--> statement-breakpoint
ALTER TABLE "ah_videos" ADD COLUMN IF NOT EXISTS "bgm_plan" jsonb;--> statement-breakpoint
ALTER TABLE "ah_videos" ADD COLUMN IF NOT EXISTS "bgm_tracks" jsonb;--> statement-breakpoint
ALTER TABLE "ah_videos" ADD COLUMN IF NOT EXISTS "bgm_video_path" text;--> statement-breakpoint
ALTER TABLE "ah_videos" ADD COLUMN IF NOT EXISTS "bgm_error" text;
