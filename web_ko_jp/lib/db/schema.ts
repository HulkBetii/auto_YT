import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const koJpPromptVersions = pgTable(
  "ko_jp_prompt_versions",
  {
    id: serial("id").primaryKey(),
    promptKey: text("prompt_key").notNull(),
    version: integer("version").notNull(),
    template: text("template").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    createdBy: text("created_by").notNull().default("manual"),
    changeReason: text("change_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ko_jp_prompt_versions_key_version_unique").on(table.promptKey, table.version),
    uniqueIndex("ko_jp_prompt_versions_one_active")
      .on(table.promptKey)
      .where(sql`${table.isActive} = true`),
  ],
);

export const KO_JP_VIDEO_STATUSES = [
  "source_pending",
  "transcribing",
  "source_audit_pending",
  "outline_pending",
  "script_drafting",
  "review_pending",
  "ready",
  "needs_attention",
] as const;

export type KoJpVideoStatus = (typeof KO_JP_VIDEO_STATUSES)[number];

export const koJpVideos = pgTable(
  "ko_jp_videos",
  {
    id: serial("id").primaryKey(),
    sourceUrl: text("source_url").notNull(),
    sourceVideoId: text("source_video_id"),
    sourceTitle: text("source_title"),
    sourceLanguage: text("source_language").notNull().default("ko"),
    targetLanguage: text("target_language").notNull().default("jp"),
    adaptationMode: text("adaptation_mode").notNull().default("philosophical_insight"),
    transcriptJobId: text("transcript_job_id"),
    transcriptText: text("transcript_text"),
    transcriptPath: text("transcript_path"),
    sourceAudit: jsonb("source_audit"),
    outline: jsonb("outline"),
    finalScriptJp: text("final_script_jp"),
    finalScriptKo: text("final_script_ko"),
    finalScriptPath: text("final_script_path"),
    titleJp: text("title_jp"),
    descriptionJp: text("description_jp"),
    thumbnailText: text("thumbnail_text"),
    thumbnailOptions: jsonb("thumbnail_options"),
    thumbnailImageUrl: text("thumbnail_image_url"),
    conversationUrl: text("conversation_url"),
    audioUrl: text("audio_url"),
    audioPath: text("audio_path"),
    audioDuration: integer("audio_duration"),
    fidelityReview: jsonb("fidelity_review"),
    status: text("status").notNull().default("source_pending"),
    sourceAuditPromptVersionId: integer("source_audit_prompt_version_id").references(
      () => koJpPromptVersions.id,
    ),
    outlinePromptVersionId: integer("outline_prompt_version_id").references(
      () => koJpPromptVersions.id,
    ),
    scriptPromptVersionId: integer("script_prompt_version_id").references(
      () => koJpPromptVersions.id,
    ),
    reviewPromptVersionId: integer("review_prompt_version_id").references(
      () => koJpPromptVersions.id,
    ),
    currentSectionIndex: integer("current_section_index"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ko_jp_videos_status_idx").on(table.status)],
);

export const koJpSections = pgTable(
  "ko_jp_sections",
  {
    id: serial("id").primaryKey(),
    videoId: integer("video_id")
      .notNull()
      .references(() => koJpVideos.id, { onDelete: "cascade" }),
    sectionIndex: integer("section_index").notNull(),
    kind: text("kind").notNull(),
    outlineData: jsonb("outline_data").notNull(),
    bodyJp: text("body_jp"),
    bodyKo: text("body_ko"),
    status: text("status").notNull().default("pending"),
    validationErrors: jsonb("validation_errors"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ko_jp_sections_video_index_unique").on(table.videoId, table.sectionIndex),
    index("ko_jp_sections_video_status_idx").on(table.videoId, table.status),
  ],
);

export const koJpJobs = pgTable(
  "ko_jp_jobs",
  {
    id: serial("id").primaryKey(),
    videoId: integer("video_id")
      .notNull()
      .references(() => koJpVideos.id, { onDelete: "cascade" }),
    sectionId: integer("section_id").references(() => koJpSections.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    status: text("status").notNull().default("pending"),
    modelLabel: text("model_label").notNull().default("GPT-5.6 Sol"),
    effort: text("effort").notNull().default("High"),
    promptText: text("prompt_text").notNull(),
    promptVersionId: integer("prompt_version_id")
      .notNull()
      .references(() => koJpPromptVersions.id),
    promptSnapshot: text("prompt_snapshot").notNull(),
    causedByJobId: integer("caused_by_job_id"),
    validationAttempt: integer("validation_attempt").notNull().default(0),
    result: text("result"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
    metadata: jsonb("metadata"),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ko_jp_jobs_open_work_unique")
      .on(
        table.videoId,
        table.stage,
        sql`coalesce(${table.sectionId}, 0)`,
        table.validationAttempt,
      )
      .where(
        sql`${table.status} in ('pending', 'running') or (${table.status} = 'done' and ${table.consumedAt} is null)`,
      ),
    index("ko_jp_jobs_queue_idx").on(table.status, table.createdAt),
  ],
);

export const koJpChannelConfig = pgTable("ko_jp_channel_config", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KoJpVideo = typeof koJpVideos.$inferSelect;
export type KoJpSection = typeof koJpSections.$inferSelect;
export type KoJpJob = typeof koJpJobs.$inferSelect;
export type KoJpPromptVersion = typeof koJpPromptVersions.$inferSelect;
