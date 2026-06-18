import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const ahChannelConfig = pgTable("ah_channel_config", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AhChannelConfig = typeof ahChannelConfig.$inferSelect;

export const AH_CONFIG_KEYS = {
  voiceId: "voice_id",
  voiceId2: "voice_id_2",
  voiceIdGx: "voice_id_gx",
  ttsProviderMode: "tts_provider_mode",
  web2Url: "web2_url",
  openaiModel: "openai_model",
  pipelinePaused: "pipeline_paused",
  cronLastRunAt: "cron_last_run_at",
  workerLastSeen: "worker_last_seen",
  toolLastActive: "tool_last_active",
  workerPaused: "worker_paused",
  toolPaused: "tool_paused",
  runVeoWatcherLastSeen: "run_veo_watcher_last_seen",
  runVeoWatcherPaused: "run_veo_watcher_paused",
  runVeoToolLastActive: "run_veo_tool_last_active",
} as const;
