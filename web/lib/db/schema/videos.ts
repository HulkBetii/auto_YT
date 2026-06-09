import { relations } from "drizzle-orm";
import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { vector } from "./columns";

/**
 * Pipeline state machine — see web/lib/pipeline/stateMachine.ts for allowed transitions.
 *   topic → outline → scripted → seo_done → scoring → ready_to_publish → published → analyzed
 *                                  ^                 \
 *                                  └── needs_retry ───┘ (score < 80, retry budget remaining)
 *   any stage → needs_attention (hard failure / retry budget exhausted / unparseable output)
 */
export const videoStatusEnum = pgEnum("video_status", [
  "topic",
  "outline",
  "scripted",
  "seo_done",
  "scoring",
  "needs_retry",
  "ready_to_publish",
  "published",
  "analyzed",
  "needs_attention",
]);

export const videoFormatEnum = pgEnum("video_format", ["standard", "comparison"]);

export const videos = pgTable("videos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  titlePattern: text("title_pattern"),
  painType: text("pain_type"),
  temperature: integer("temperature"),
  featuredPerson: text("featured_person"),
  referenceBook: text("reference_book"),
  format: videoFormatEnum("format").notNull().default("standard"),
  status: videoStatusEnum("status").notNull().default("topic"),
  score: integer("score"),
  /** Content-quality retry counter (P_score < 80 loop) — distinct from jobs.retry_count (transient Playwright errors). */
  retryCount: integer("retry_count").notNull().default(0),
  /** OpenAI text-embedding-3-small (1536-dim) of `topic + title` — semantic dedup via pgvector cosine distance. */
  topicEmbedding: vector(1536)("topic_embedding"),
  /** Filled manually after the video is uploaded — required to poll YouTube Data API for analytics (P5 trigger). */
  youtubeVideoId: text("youtube_video_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  /** CDN URL of the AI33.PRO TTS-generated audio file. NULL until the TTS pass runs after ready_to_publish. */
  audioUrl: text("audio_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const videosRelations = relations(videos, ({ many }) => ({
  content: many(videoContentTableRef),
  analytics: many(videoAnalyticsTableRef),
}));

// Lazy refs to avoid circular import cycles between schema files at module-eval time —
// Drizzle resolves these via the relations() callback, not at declaration time.
import { videoContent as videoContentTableRef } from "./video-content";
import { videoAnalytics as videoAnalyticsTableRef } from "./video-analytics";
