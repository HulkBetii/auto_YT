ALTER TABLE "ko_videos" ADD COLUMN "raw_transcript_text" text;--> statement-breakpoint
ALTER TABLE "ko_videos" ADD COLUMN "raw_transcript_path" text;--> statement-breakpoint
ALTER TABLE "ko_videos" ADD COLUMN "raw_transcript_json_path" text;--> statement-breakpoint
ALTER TABLE "ko_videos" ADD COLUMN "source_audit" jsonb;--> statement-breakpoint
ALTER TABLE "ko_videos" ADD COLUMN "fidelity_review" jsonb;--> statement-breakpoint
ALTER TABLE "ko_videos" ADD COLUMN "source_audit_prompt_version_id" integer;--> statement-breakpoint
ALTER TABLE "ko_videos" ADD COLUMN "fidelity_prompt_version_id" integer;--> statement-breakpoint
ALTER TABLE "ko_videos" ADD CONSTRAINT "ko_videos_source_audit_prompt_version_id_ko_prompt_versions_id_fk" FOREIGN KEY ("source_audit_prompt_version_id") REFERENCES "public"."ko_prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ko_videos" ADD CONSTRAINT "ko_videos_fidelity_prompt_version_id_ko_prompt_versions_id_fk" FOREIGN KEY ("fidelity_prompt_version_id") REFERENCES "public"."ko_prompt_versions"("id") ON DELETE no action ON UPDATE no action;