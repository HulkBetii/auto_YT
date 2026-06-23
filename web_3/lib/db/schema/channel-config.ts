import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const drChannelConfig = pgTable("dr_channel_config", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DrChannelConfig = typeof drChannelConfig.$inferSelect;

export const DR_CONFIG_KEYS = {
  pipelinePaused: "pipeline_paused",
  cronLastRunAt: "cron_last_run_at",
  workerLastSeen: "worker_last_seen",
  workerPaused: "worker_paused",
  toolLastActive: "tool_last_active",
  toolPaused: "tool_paused",
  web3Url: "web3_url",
  // Local assembly watcher (kept for the deferred local pipeline).
  runVeoWatcherLastSeen: "run_veo_watcher_last_seen",
  runVeoWatcherPaused: "run_veo_watcher_paused",
  runVeoToolLastActive: "run_veo_tool_last_active",
  // Pipeline tuning.
  targetSceneCount: "target_scene_count",
  sunoModelVersion: "suno_model_version",
  // Drop Suno clips shorter than this (seconds) during primary selection.
  minClipSec: "min_clip_sec",
  // Crossfade length (seconds) used by BOTH the assembler and the chapter math.
  crossfadeSec: "crossfade_sec",
  // When "true", the Suno fan-out is held (lets you run D0..D2 without spending
  // music credits). Episodes wait in suno_pending until it is cleared.
  sunoPaused: "suno_paused",
} as const;
