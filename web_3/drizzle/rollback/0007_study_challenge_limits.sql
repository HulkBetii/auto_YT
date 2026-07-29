BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "study_audio_weeks" WHERE "week_number" > 15) THEN
    RAISE EXCEPTION
      'Cannot rollback Study challenge limits: study_audio_weeks contains week_number above 15.';
  END IF;

  IF EXISTS (SELECT 1 FROM "study_daily_videos" WHERE "day_number" > 100) THEN
    RAISE EXCEPTION
      'Cannot rollback Study challenge limits: study_daily_videos contains day_number above 100.';
  END IF;
END $$;

ALTER TABLE "study_audio_weeks"
  DROP CONSTRAINT "study_audio_weeks_week_number_check";
ALTER TABLE "study_daily_videos"
  DROP CONSTRAINT "study_daily_videos_day_number_check";
ALTER TABLE "study_audio_weeks"
  ADD CONSTRAINT "study_audio_weeks_week_number_check"
  CHECK ("week_number" BETWEEN 1 AND 15);
ALTER TABLE "study_daily_videos"
  ADD CONSTRAINT "study_daily_videos_day_number_check"
  CHECK ("day_number" BETWEEN 1 AND 100);

COMMIT;
