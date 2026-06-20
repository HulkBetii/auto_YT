ALTER TABLE "ah_videos" ADD COLUMN IF NOT EXISTS "yt_chapters" jsonb;--> statement-breakpoint
ALTER TABLE "ah_videos" ADD COLUMN IF NOT EXISTS "yt_thumbnail" jsonb;
