import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { drEpisodes } from "./episodes";

export const drJobs = pgTable(
  "dr_jobs",
  {
    id: serial("id").primaryKey(),
    episodeId: integer("episode_id").references(() => drEpisodes.id),
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
    uniqueIndex("dr_jobs_open_episode_stage_unique")
      .on(table.episodeId, table.stage)
      .where(
        sql`${table.episodeId} is not null and (${table.status} in ('pending', 'running') or (${table.status} = 'done' and ${table.consumedAt} is null))`,
      ),
  ],
);

export type DrJob = typeof drJobs.$inferSelect;
export type NewDrJob = typeof drJobs.$inferInsert;

export const DR_STAGES = ["D0", "D1", "D2A", "D2B", "D2C", "D3", "D4"] as const;
export type DrStage = (typeof DR_STAGES)[number];
