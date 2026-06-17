WITH ranked_open_jobs AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY video_id, stage ORDER BY id) AS rn
  FROM ah_jobs
  WHERE video_id IS NOT NULL
    AND (
      status IN ('pending', 'running')
      OR (status = 'done' AND consumed_at IS NULL)
    )
)
UPDATE ah_jobs
SET
  status = 'failed',
  error_message = COALESCE(error_message, 'deduped duplicate open job before ah_jobs_open_video_stage_unique'),
  consumed_at = COALESCE(consumed_at, now()),
  finished_at = COALESCE(finished_at, now())
WHERE id IN (SELECT id FROM ranked_open_jobs WHERE rn > 1);--> statement-breakpoint
CREATE UNIQUE INDEX "ah_jobs_open_video_stage_unique" ON "ah_jobs" USING btree ("video_id","stage") WHERE "ah_jobs"."video_id" is not null and ("ah_jobs"."status" in ('pending', 'running') or ("ah_jobs"."status" = 'done' and "ah_jobs"."consumed_at" is null));
