ALTER TABLE "ah_prompt_versions" ADD COLUMN IF NOT EXISTS "prompt_set_version" text NOT NULL DEFAULT 'current';--> statement-breakpoint
ALTER TABLE "ah_videos" ADD COLUMN IF NOT EXISTS "prompt_set_version" text NOT NULL DEFAULT 'current';
