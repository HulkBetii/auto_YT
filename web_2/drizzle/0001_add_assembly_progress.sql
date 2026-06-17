ALTER TABLE "ah_videos" ADD COLUMN "image_count_expected" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "ah_videos" ADD COLUMN "image_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "ah_videos" ADD COLUMN "video_path" text;