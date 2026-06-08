import { relations } from "drizzle-orm";
import {
  integer,
  pgTable,
  serial,
  timestamp,
} from "drizzle-orm/pg-core";

import { videos } from "./videos";

/** Snapshot of YouTube Data API stats for a published video — polled by the P5-trigger cron once views >= 100. */
export const videoAnalytics = pgTable("video_analytics", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id")
    .notNull()
    .references(() => videos.id),
  views: integer("views").notNull(),
  likes: integer("likes"),
  comments: integer("comments"),
  /** Click-through rate in basis points (e.g. 850 = 8.50%) — primary metric for rollback comparison. */
  ctrBasisPoints: integer("ctr_basis_points"),
  averageViewDurationSeconds: integer("average_view_duration_seconds"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const videoAnalyticsRelations = relations(videoAnalytics, ({ one }) => ({
  video: one(videos, {
    fields: [videoAnalytics.videoId],
    references: [videos.id],
  }),
}));
