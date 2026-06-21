ALTER TABLE "ah_videos" ADD COLUMN IF NOT EXISTS "published_at" timestamptz;--> statement-breakpoint
ALTER TABLE "ah_videos" ADD COLUMN IF NOT EXISTS "youtube_url" text;
