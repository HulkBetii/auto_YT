ALTER TABLE "ko_jp_videos" ADD COLUMN "title_jp" text;--> statement-breakpoint
ALTER TABLE "ko_jp_videos" ADD COLUMN "description_jp" text;--> statement-breakpoint
ALTER TABLE "ko_jp_videos" ADD COLUMN "thumbnail_text" text;--> statement-breakpoint
ALTER TABLE "ko_jp_videos" ADD COLUMN "thumbnail_options" jsonb;--> statement-breakpoint
ALTER TABLE "ko_jp_videos" ADD COLUMN "conversation_url" text;