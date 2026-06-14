import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const ahVideos = pgTable("ah_videos", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("s1_pending"),
  voiceId: text("voice_id"),
  topicCandidates: jsonb("topic_candidates"),
  chosenTopic: jsonb("chosen_topic"),
  script: text("script"),
  scriptSlug: text("script_slug"),
  audioUrl: text("audio_url"),
  whisperTranscript: text("whisper_transcript"),
  imagePrompts: text("image_prompts"),
  ytTitle: text("yt_title"),
  ytDescription: text("yt_description"),
  ytTags: text("yt_tags"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AhVideo = typeof ahVideos.$inferSelect;
export type NewAhVideo = typeof ahVideos.$inferInsert;

export const AH_STATUSES = [
  "s1_pending",
  "s2_pending",
  "tts_pending",
  "s3_pending",
  "s4_pending",
  "ready",
  "needs_attention",
] as const;

export type AhVideoStatus = (typeof AH_STATUSES)[number];

// Map status → pipeline step index (0-based, max 5)
export const STATUS_STEP: Record<string, number> = {
  s1_pending: 0,
  s2_pending: 1,
  tts_pending: 2,
  s3_pending: 3,
  s4_pending: 4,
  ready: 5,
  needs_attention: -1,
};

// Human-readable labels
export const STATUS_LABELS: Record<string, string> = {
  s1_pending: "Topics",
  s2_pending: "Script",
  tts_pending: "TTS",
  s3_pending: "Images",
  s4_pending: "Metadata",
  ready: "Ready",
  needs_attention: "Failed",
};

// Map video status → integer for the "active" step index being shown as running
// (which step is currently running, not done)
export const STATUS_ACTIVE_STEP: Record<string, number> = {
  s1_pending: 0,  // S1 running
  s2_pending: 1,  // S2 running
  tts_pending: 2, // TTS running
  s3_pending: 3,  // S3 running
  s4_pending: 4,  // S4 running
  ready: 5,       // all done
  needs_attention: -1,
};

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_")
    .slice(0, 60);
}

export const IN_PIPELINE_STATUSES: AhVideoStatus[] = [
  "s1_pending",
  "s2_pending",
  "tts_pending",
  "s3_pending",
  "s4_pending",
];
