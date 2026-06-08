import { relations } from "drizzle-orm";
import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { promptVersions } from "./prompt-versions";
import { videos } from "./videos";

/** One row per pipeline stage output for a video — keeps the full P1..P5 history (P6 is batch-level, stored on prompt_versions.change_reason instead). */
export const contentStageEnum = pgEnum("content_stage", [
  "P1",
  "P2",
  "P3",
  "P4",
  "P_score",
  "P5",
]);

export const videoContent = pgTable("video_content", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id")
    .notNull()
    .references(() => videos.id),
  stage: contentStageEnum("stage").notNull(),
  /** Raw ChatGPT response text for this stage. */
  output: text("output").notNull(),
  /** Snapshot of the prompt_versions row used to produce this output — for audit + retry consistency. */
  promptVersionId: integer("prompt_version_id").references(() => promptVersions.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const videoContentRelations = relations(videoContent, ({ one }) => ({
  video: one(videos, {
    fields: [videoContent.videoId],
    references: [videos.id],
  }),
}));
