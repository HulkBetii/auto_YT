ALTER TABLE "videos" ADD COLUMN "render_status" text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "video_path" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "whisper_transcript" text;