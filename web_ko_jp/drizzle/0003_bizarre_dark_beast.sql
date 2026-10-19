CREATE TABLE "ko_jp_youtube_uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"stage" text DEFAULT 'preflight_ok' NOT NULL,
	"youtube_video_id" text,
	"artifact_sha256" text,
	"snapshot" jsonb,
	"gate_status" text,
	"warn_acknowledged_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ko_jp_videos" ADD COLUMN IF NOT EXISTS "audio_url" text;--> statement-breakpoint
ALTER TABLE "ko_jp_videos" ADD COLUMN IF NOT EXISTS "audio_path" text;--> statement-breakpoint
ALTER TABLE "ko_jp_videos" ADD COLUMN IF NOT EXISTS "audio_duration" integer;--> statement-breakpoint
ALTER TABLE "ko_jp_youtube_uploads" ADD CONSTRAINT "ko_jp_youtube_uploads_video_id_ko_jp_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."ko_jp_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ko_jp_youtube_uploads_active_unique" ON "ko_jp_youtube_uploads" USING btree ("video_id") WHERE "ko_jp_youtube_uploads"."stage" != 'failed';--> statement-breakpoint
CREATE INDEX "ko_jp_youtube_uploads_video_stage_idx" ON "ko_jp_youtube_uploads" USING btree ("video_id","stage");