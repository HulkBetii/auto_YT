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

export const koPromptVersions = pgTable(
  "ko_prompt_versions",
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
    uniqueIndex("ko_prompt_versions_key_version_unique").on(table.promptKey, table.version),
    uniqueIndex("ko_prompt_versions_one_active")
      .on(table.promptKey)
      .where(sql`${table.isActive} = true`),
  ],
);

export const koVideos = pgTable(
  "ko_videos",
  {
    id: serial("id").primaryKey(),
    sourceUrl: text("source_url").notNull(),
    sourceVideoId: text("source_video_id"),
    sourceTitle: text("source_title"),
    transcriptJobId: text("transcript_job_id"),
    transcriptLanguage: text("transcript_language"),
    transcriptLanguageConfidence: text("transcript_language_confidence"),
    rawTranscriptText: text("raw_transcript_text"),
    rawTranscriptPath: text("raw_transcript_path"),
    rawTranscriptJsonPath: text("raw_transcript_json_path"),
    transcriptText: text("transcript_text"),
    transcriptPath: text("transcript_path"),
    transcriptHash: text("transcript_hash"),
    sourceAudit: jsonb("source_audit"),
    status: text("status").notNull().default("transcript_pending"),
    outline: jsonb("outline"),
    conversationUrl: text("conversation_url"),
    finalScript: text("final_script"),
    finalScriptPath: text("final_script_path"),
    fidelityReview: jsonb("fidelity_review"),
    sourceAuditPromptVersionId: integer("source_audit_prompt_version_id").references(
      () => koPromptVersions.id,
    ),
    outlinePromptVersionId: integer("outline_prompt_version_id")
      .notNull()
      .references(() => koPromptVersions.id),
    sectionPromptVersionId: integer("section_prompt_version_id")
      .notNull()
      .references(() => koPromptVersions.id),
    fidelityPromptVersionId: integer("fidelity_prompt_version_id").references(
      () => koPromptVersions.id,
    ),
    currentSectionIndex: integer("current_section_index"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ko_videos_status_idx").on(table.status)],
);

export const koSections = pgTable(
  "ko_sections",
  {
    id: serial("id").primaryKey(),
    videoId: integer("video_id")
      .notNull()
      .references(() => koVideos.id, { onDelete: "cascade" }),
    sectionIndex: integer("section_index").notNull(),
    kind: text("kind").notNull(),
    outlineData: jsonb("outline_data").notNull(),
    body: text("body"),
    status: text("status").notNull().default("pending"),
    validationErrors: jsonb("validation_errors"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ko_sections_video_index_unique").on(table.videoId, table.sectionIndex),
    index("ko_sections_video_status_idx").on(table.videoId, table.status),
  ],
);

export const koJobs = pgTable(
  "ko_jobs",
  {
    id: serial("id").primaryKey(),
    videoId: integer("video_id")
      .notNull()
      .references(() => koVideos.id, { onDelete: "cascade" }),
    sectionId: integer("section_id").references(() => koSections.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    modelLabel: text("model_label").notNull(),
    effort: text("effort").notNull(),
    promptText: text("prompt_text").notNull(),
    promptVersionId: integer("prompt_version_id")
      .notNull()
      .references(() => koPromptVersions.id),
    promptSnapshot: text("prompt_snapshot").notNull(),
    attachmentPath: text("attachment_path"),
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
    uniqueIndex("ko_jobs_open_work_unique")
      .on(
        table.videoId,
        table.kind,
        sql`coalesce(${table.sectionId}, 0)`,
        table.validationAttempt,
      )
      .where(
        sql`${table.status} in ('pending', 'running') or (${table.status} = 'done' and ${table.consumedAt} is null)`,
      ),
    index("ko_jobs_queue_idx").on(table.status, table.createdAt),
  ],
);

export const koChannelConfig = pgTable("ko_channel_config", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const KO_VIDEO_STATUSES = [
  "transcript_pending",
  "transcribing",
  "source_audit_pending",
  "outline_pending",
  "sections_pending",
  "final_review_pending",
  "ready",
  "needs_attention",
] as const;

export type KoVideoStatus = (typeof KO_VIDEO_STATUSES)[number];
export type KoVideo = typeof koVideos.$inferSelect;
export type KoSection = typeof koSections.$inferSelect;
export type KoJob = typeof koJobs.$inferSelect;
export type KoPromptVersion = typeof koPromptVersions.$inferSelect;
