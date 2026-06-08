import { relations } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { promptVersions } from "./prompt-versions";
import { videos } from "./videos";

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "done",
  "failed",
]);

export const jobStageEnum = pgEnum("job_stage", [
  "P1",
  "P2",
  "P3",
  "P4",
  "P_score",
  "P5",
  "P6",
]);

/**
 * The ONLY communication contract between the Next.js orchestrator and the Python/Playwright
 * worker — claimed via `SELECT ... FOR UPDATE SKIP LOCKED`, polled every 15s.
 * `prompt_text` is the fully pre-interpolated prompt (snapshot), so retries stay consistent
 * even if `prompt_versions` changes mid-flight.
 */
export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id").references(() => videos.id),
  stage: jobStageEnum("stage").notNull(),
  status: jobStatusEnum("status").notNull().default("pending"),
  promptText: text("prompt_text").notNull(),
  promptVersionId: integer("prompt_version_id")
    .notNull()
    .references(() => promptVersions.id),
  result: text("result"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  /** Arbitrary stage-specific payload (e.g. P5/P6 batch video id lists). */
  metadata: jsonb("metadata"),
  /** Set by the `process-jobs` cron once it has chained this job's output onward — prevents double-processing. */
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const jobsRelations = relations(jobs, ({ one }) => ({
  video: one(videos, {
    fields: [jobs.videoId],
    references: [videos.id],
  }),
  promptVersion: one(promptVersions, {
    fields: [jobs.promptVersionId],
    references: [promptVersions.id],
  }),
}));
