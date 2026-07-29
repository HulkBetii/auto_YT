import {
  check,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const STUDY_AUDIO_WEEK_STATUSES = [
  "draft",
  "generating",
  "awaiting_rights",
  "ready",
  "failed",
] as const;
export type StudyAudioWeekStatus = (typeof STUDY_AUDIO_WEEK_STATUSES)[number];

export const STUDY_DAILY_VIDEO_STATUSES = ["draft", "assembling", "done", "failed"] as const;
export type StudyDailyVideoStatus = (typeof STUDY_DAILY_VIDEO_STATUSES)[number];

export const STUDY_VIDEO_PREVIEW_STATUSES = ["idle", "rendering", "done", "failed"] as const;
export type StudyVideoPreviewStatus = (typeof STUDY_VIDEO_PREVIEW_STATUSES)[number];

export interface StudyAudioTrackFile {
  fileName: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  durationSec: number;
  codecName: string;
  sampleRate: number | null;
  channels: number | null;
}

export interface StudyAudioTrackManifest {
  files: StudyAudioTrackFile[];
  scannedAt: string;
}

export type StudyMusicGenerationTaskStatus =
  | "submitting"
  | "doing"
  | "done"
  | "error"
  | "ambiguous";

interface StudyMusicGenerationTaskBase {
  submissionIndex: number;
  status: StudyMusicGenerationTaskStatus;
  providerTaskId?: string;
  submittedAt: string;
  finishedAt?: string;
  errorMessage?: string;
  creditCost?: number;
  targetSlot?: number;
}

type StudyMusicGenerationIdentity =
  | { taskIndex: number; phase?: never }
  | { taskIndex?: never; phase: string };

export type StudyMusicGenerationTask = StudyMusicGenerationTaskBase &
  StudyMusicGenerationIdentity;

interface StudyMusicGenerationSlotBase {
  slotNumber: number;
  status: "pending" | "downloaded";
  fileName?: string;
  relativePath?: string;
  sha256?: string;
  sizeBytes?: number;
  durationSec?: number;
  codecName?: string;
  sampleRate?: number | null;
  channels?: number | null;
  providerTaskId?: string;
  providerClipId?: string;
  sourceUrl?: string;
}

export type StudyMusicGenerationSlot = StudyMusicGenerationSlotBase &
  StudyMusicGenerationIdentity;

export type StudyTrackRegenerationState =
  | "claimed"
  | "submitting"
  | "polling"
  | "staged"
  | "backed_up"
  | "promoted"
  | "failed";

export interface StudyTrackRegenerationJournal {
  runId: string;
  targetSlot: number;
  previousStatus: "ready" | "awaiting_rights";
  previousRightsVerifiedAt: string | null;
  state: StudyTrackRegenerationState;
  originalSlot: StudyMusicGenerationSlot;
  originalTrack: StudyAudioTrackFile;
  submissionIndex?: number;
  stagedRelativePath?: string;
  backupRelativePath?: string;
  startedAt: string;
  updatedAt: string;
  errorMessage?: string;
}

export interface StudyMusicGenerationManifest {
  promptVersion: string;
  provider: "ai33.pro";
  maxProviderTasks: number;
  tasks: StudyMusicGenerationTask[];
  slots: StudyMusicGenerationSlot[];
  lastKnownCredits: number | null;
  updatedAt: string;
  activeRegeneration?: StudyTrackRegenerationJournal;
}

export interface StudyFootageFile {
  fileName: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  frameRate: number;
  codecName: string;
  hasAudio: boolean;
}

export interface StudyFootageManifest {
  files: StudyFootageFile[];
  scannedAt: string;
}

export const studyAudioWeeks = pgTable(
  "study_audio_weeks",
  {
    id: serial("id").primaryKey(),
    weekNumber: integer("week_number").notNull().unique(),
    status: text("status").notNull().default("draft"),
    trackManifest: jsonb("track_manifest").$type<StudyAudioTrackManifest>(),
    generationManifest: jsonb("generation_manifest").$type<StudyMusicGenerationManifest>(),
    generationRunId: text("generation_run_id"),
    generationStartedAt: timestamp("generation_started_at", { withTimezone: true }),
    generationHeartbeatAt: timestamp("generation_heartbeat_at", { withTimezone: true }),
    generationFinishedAt: timestamp("generation_finished_at", { withTimezone: true }),
    totalDurationSec: integer("total_duration_sec"),
    rightsVerifiedAt: timestamp("rights_verified_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("study_audio_weeks_week_number_check", sql`${table.weekNumber} BETWEEN 1 AND 53`),
    check(
      "study_audio_weeks_status_check",
      sql`${table.status} IN ('draft', 'generating', 'awaiting_rights', 'ready', 'failed')`,
    ),
  ],
);

export const studyDailyVideos = pgTable(
  "study_daily_videos",
  {
    id: serial("id").primaryKey(),
    dayNumber: integer("day_number").notNull().unique(),
    weekId: integer("week_id")
      .notNull()
      .references(() => studyAudioWeeks.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("draft"),
    footageManifest: jsonb("footage_manifest").$type<StudyFootageManifest>(),
    durationSec: integer("duration_sec"),
    inputSignature: text("input_signature"),
    masterSignature: text("master_signature"),
    masterPath: text("master_path"),
    masterCreatedAt: timestamp("master_created_at", { withTimezone: true }),
    finalVideoPath: text("final_video_path"),
    errorMessage: text("error_message"),
    assemblyStartedAt: timestamp("assembly_started_at", { withTimezone: true }),
    assemblyFinishedAt: timestamp("assembly_finished_at", { withTimezone: true }),
    previewStatus: text("preview_status").notNull().default("idle"),
    previewRunId: text("preview_run_id"),
    previewHeartbeatAt: timestamp("preview_heartbeat_at", { withTimezone: true }),
    previewRequestedOffsetSec: doublePrecision("preview_requested_offset_sec"),
    previewActualOffsetSec: doublePrecision("preview_actual_offset_sec"),
    previewStartedAt: timestamp("preview_started_at", { withTimezone: true }),
    previewFinishedAt: timestamp("preview_finished_at", { withTimezone: true }),
    previewErrorMessage: text("preview_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("study_daily_videos_day_number_check", sql`${table.dayNumber} BETWEEN 1 AND 365`),
    check(
      "study_daily_videos_status_check",
      sql`${table.status} IN ('draft', 'assembling', 'done', 'failed')`,
    ),
    check(
      "study_daily_videos_preview_status_check",
      sql`${table.previewStatus} IN ('idle', 'rendering', 'done', 'failed')`,
    ),
  ],
);

export type StudyAudioWeek = typeof studyAudioWeeks.$inferSelect;
export type NewStudyAudioWeek = typeof studyAudioWeeks.$inferInsert;
export type StudyDailyVideo = typeof studyDailyVideos.$inferSelect;
export type NewStudyDailyVideo = typeof studyDailyVideos.$inferInsert;
