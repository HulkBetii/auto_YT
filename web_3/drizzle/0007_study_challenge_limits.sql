ALTER TABLE "study_audio_weeks" DROP CONSTRAINT "study_audio_weeks_week_number_check";--> statement-breakpoint
ALTER TABLE "study_daily_videos" DROP CONSTRAINT "study_daily_videos_day_number_check";--> statement-breakpoint
ALTER TABLE "study_audio_weeks" ADD CONSTRAINT "study_audio_weeks_week_number_check" CHECK ("study_audio_weeks"."week_number" BETWEEN 1 AND 53);--> statement-breakpoint
ALTER TABLE "study_daily_videos" ADD CONSTRAINT "study_daily_videos_day_number_check" CHECK ("study_daily_videos"."day_number" BETWEEN 1 AND 365);