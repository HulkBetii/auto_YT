import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { ahVideos } from "./videos";

export const ahJobs = pgTable(
  "ah_jobs",
  {
    id: serial("id").primaryKey(),
    videoId: integer("video_id").references(() => ahVideos.id),
    stage: text("stage").notNull(),
    status: text("status").notNull().default("pending"),
    promptText: text("prompt_text").notNull(),
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
    uniqueIndex("ah_jobs_open_video_stage_unique")
      .on(table.videoId, table.stage)
      .where(
        sql`${table.videoId} is not null and (${table.status} in ('pending', 'running') or (${table.status} = 'done' and ${table.consumedAt} is null))`,
      ),
  ],
);

export type AhJob = typeof ahJobs.$inferSelect;
export type NewAhJob = typeof ahJobs.$inferInsert;

export const AH_STAGES = ["S1", "S2", "S3", "S4"] as const;
export type AhStage = (typeof AH_STAGES)[number];
