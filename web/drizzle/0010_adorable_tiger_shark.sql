ALTER TABLE "videos" ADD COLUMN "tts_text" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "render_error" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "render_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "render_next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "render_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "render_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "render_finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "render_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "render_worker_token" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "rendered_audio_url" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "render_source_hash" text;--> statement-breakpoint
CREATE INDEX "videos_render_queue_idx" ON "videos" USING btree ("render_status","render_next_attempt_at","render_requested_at","id");