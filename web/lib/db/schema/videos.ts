import { relations } from "drizzle-orm";
import {
  index,
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

export const videos = pgTable(
  "videos",
  {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  titlePattern: text("title_pattern"),
  painType: text("pain_type"),
  temperature: integer("temperature"),
  featuredPerson: text("featured_person"),
  referenceBook: text("reference_book"),
  contentArchetype: text("content_archetype"),
  personaMode: text("persona_mode"),
  hookType: text("hook_type"),
  commentMode: text("comment_mode"),
  listCount: integer("list_count"),
  corePromise: text("core_promise"),
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
  /** AI33.PRO task_id of the in-flight TTS job. Set when submitted, cleared when audio_url is saved.
   *  Prevents duplicate submissions when cron fires before the previous task completes. */
  ttsTaskId: text("tts_task_id"),
  /** Exact narration submitted to the TTS provider, including supported pause tags. */
  ttsText: text("tts_text"),
  /** UTC timestamp when the TTS task was submitted. Used to detect stale tasks (> 15 min without completion). */
  ttsSubmittedAt: timestamp("tts_submitted_at", { withTimezone: true }),
  /**
   * Video render lifecycle — ORTHOGONAL to `status` (a video can be published AND render_status=done).
   * Driven entirely by the local render worker (src/auto_yt/render_worker.py), never by the serverless
   * chain. not_started → rendering → done | failed. Vercel can't run ffmpeg, so this lives out-of-band.
   */
  renderStatus: text("render_status").notNull().default("not_started"),
  /** Local filesystem path of the rendered final_video.mp4 (written by the local render worker). */
  videoPath: text("video_path"),
  /** Whisper transcript retained for alignment audit; display text comes from tts_text. */
  whisperTranscript: text("whisper_transcript"),
  renderError: text("render_error"),
  renderAttemptCount: integer("render_attempt_count").notNull().default(0),
  renderNextAttemptAt: timestamp("render_next_attempt_at", { withTimezone: true }),
  renderRequestedAt: timestamp("render_requested_at", { withTimezone: true }),
  renderStartedAt: timestamp("render_started_at", { withTimezone: true }),
  renderFinishedAt: timestamp("render_finished_at", { withTimezone: true }),
  renderHeartbeatAt: timestamp("render_heartbeat_at", { withTimezone: true }),
  renderWorkerToken: text("render_worker_token"),
  renderedAudioUrl: text("rendered_audio_url"),
  renderSourceHash: text("render_source_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("videos_render_queue_idx").on(
      table.renderStatus,
      table.renderNextAttemptAt,
      table.renderRequestedAt,
      table.id,
    ),
  ],
);

/** render_status values — kept as TEXT (not a pgEnum) so the Python worker writes raw strings without a cast. */
export const RENDER_STATUSES = ["not_started", "rendering", "done", "failed"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

export const videosRelations = relations(videos, ({ many }) => ({
  content: many(videoContentTableRef),
  analytics: many(videoAnalyticsTableRef),
}));

// Lazy refs to avoid circular import cycles between schema files at module-eval time —
// Drizzle resolves these via the relations() callback, not at declaration time.
import { videoContent as videoContentTableRef } from "./video-content";
import { videoAnalytics as videoAnalyticsTableRef } from "./video-analytics";
