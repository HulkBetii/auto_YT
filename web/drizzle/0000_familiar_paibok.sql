CREATE TYPE "public"."worker_status" AS ENUM('running', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."job_stage" AS ENUM('P1', 'P2', 'P3', 'P4', 'P_score', 'P5', 'P6');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."prompt_created_by" AS ENUM('system_p6', 'system_rollback', 'manual');--> statement-breakpoint
CREATE TYPE "public"."prompt_key" AS ENUM('P1', 'P2', 'P3', 'P4', 'P_score', 'P5', 'P6');--> statement-breakpoint
CREATE TYPE "public"."content_stage" AS ENUM('P1', 'P2', 'P3', 'P4', 'P_score');--> statement-breakpoint
CREATE TYPE "public"."video_format" AS ENUM('standard', 'comparison');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('topic', 'outline', 'scripted', 'seo_done', 'scoring', 'needs_retry', 'ready_to_publish', 'published', 'analyzed', 'needs_attention');--> statement-breakpoint
CREATE TABLE "channel_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"worker_last_seen_at" timestamp with time zone,
	"worker_last_status" "worker_status",
	"rollback_count_30d" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer,
	"stage" "job_stage" NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"prompt_text" text NOT NULL,
	"prompt_version_id" integer NOT NULL,
	"result" text,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt_key" "prompt_key" NOT NULL,
	"version" integer NOT NULL,
	"template" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" "prompt_created_by" DEFAULT 'manual' NOT NULL,
	"change_reason" text,
	"effective_from_video_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_analytics" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"views" integer NOT NULL,
	"likes" integer,
	"comments" integer,
	"ctr_basis_points" integer,
	"average_view_duration_seconds" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_content" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" integer NOT NULL,
	"stage" "content_stage" NOT NULL,
	"output" text NOT NULL,
	"prompt_version_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"title_pattern" text,
	"pain_type" text,
	"temperature" integer,
	"featured_person" text,
	"reference_book" text,
	"format" "video_format" DEFAULT 'standard' NOT NULL,
	"status" "video_status" DEFAULT 'topic' NOT NULL,
	"score" integer,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"topic_embedding" vector(1536),
	"youtube_video_id" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_effective_from_video_id_videos_id_fk" FOREIGN KEY ("effective_from_video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_analytics" ADD CONSTRAINT "video_analytics_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_content" ADD CONSTRAINT "video_content_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_content" ADD CONSTRAINT "video_content_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;