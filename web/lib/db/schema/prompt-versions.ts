import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { videos } from "./videos";

/** P1..P6 generation prompts + P_score (self-scoring rubric prompt). */
export const promptKeyEnum = pgEnum("prompt_key", [
  "P1",
  "P2",
  "P3",
  "P4",
  "P_score",
  "P5",
  "P6",
]);

/** Who produced this version — used to distinguish autonomous rewrites from manual overrides/rollbacks. */
export const promptCreatedByEnum = pgEnum("prompt_created_by", [
  "system_p6",
  "system_rollback",
  "manual",
]);

export const promptVersions = pgTable("prompt_versions", {
  id: serial("id").primaryKey(),
  promptKey: promptKeyEnum("prompt_key").notNull(),
  version: integer("version").notNull(),
  /** Template text containing `[PLACEHOLDER]` tokens — interpolated at job-creation time. */
  template: text("template").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdBy: promptCreatedByEnum("created_by").notNull().default("manual"),
  /** P6's analysis report / rollback rationale — the permanent "report" trail for auto-applied changes. */
  changeReason: text("change_reason"),
  /** First video that used this version — anchor point for rollback batch comparison. */
  effectiveFromVideoId: integer("effective_from_video_id").references(
    () => videos.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const promptVersionsRelations = relations(promptVersions, ({ one }) => ({
  effectiveFromVideo: one(videos, {
    fields: [promptVersions.effectiveFromVideoId],
    references: [videos.id],
  }),
}));
