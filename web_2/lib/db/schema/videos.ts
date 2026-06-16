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
  // Assembly tracking (updated by local Mac worker via /api/videos/[id]/progress)
  imageCountExpected: integer("image_count_expected").default(0),
  imageCount: integer("image_count").default(0),
  videoPath: text("video_path"),
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
  "image_gen_pending",
  "assembly_pending",
  "assembly_done",
  "needs_attention",
] as const;

export type AhVideoStatus = (typeof AH_STATUSES)[number];

// Steps: S1(0) S2(1) TTS(2) S3(3) S4(4) IMG(5) ASSEMBLE(6) — total 7
// doneCount = how many steps are fully green
export const STATUS_STEP: Record<string, number> = {
  s1_pending:        0,
  s2_pending:        1,
  tts_pending:       2,
  s3_pending:        3,
  s4_pending:        4,
  ready:             5,
  image_gen_pending: 5,
  assembly_pending:  6,
  assembly_done:     7,
  needs_attention:   -1,
};

// Human-readable labels
export const STATUS_LABELS: Record<string, string> = {
  s1_pending:        "Topics",
  s2_pending:        "Script",
  tts_pending:       "TTS",
  s3_pending:        "Img Prompts",
  s4_pending:        "Metadata",
  ready:             "Ready",
  image_gen_pending: "Gen Images",
  assembly_pending:  "Assembling",
  assembly_done:     "Done",
  needs_attention:   "Failed",
};

// active step index (which step is pulsing yellow)
export const STATUS_ACTIVE_STEP: Record<string, number> = {
  s1_pending:        0,
  s2_pending:        1,
  tts_pending:       2,
  s3_pending:        3,
  s4_pending:        4,
  ready:             5,
  image_gen_pending: 5,
  assembly_pending:  6,
  assembly_done:     -1,
  needs_attention:   -1,
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
  "image_gen_pending",
  "assembly_pending",
];
