ALTER TABLE "study_audio_weeks" DROP CONSTRAINT "study_audio_weeks_status_check";--> statement-breakpoint
ALTER TABLE "study_audio_weeks" ADD COLUMN "generation_manifest" jsonb;--> statement-breakpoint
ALTER TABLE "study_audio_weeks" ADD COLUMN "generation_run_id" text;--> statement-breakpoint
ALTER TABLE "study_audio_weeks" ADD COLUMN "generation_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_audio_weeks" ADD COLUMN "generation_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_audio_weeks" ADD COLUMN "generation_finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_audio_weeks" ADD CONSTRAINT "study_audio_weeks_status_check" CHECK ("study_audio_weeks"."status" IN ('draft', 'generating', 'awaiting_rights', 'ready', 'failed'));