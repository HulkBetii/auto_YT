import { jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// One episode = one DRIFTER 2077 long-form ambient video:
// 1 looping pixel-art scene + a playlist of Suno-generated dark-jazz tracks.
export const drEpisodes = pgTable("dr_episodes", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("d1_pending"),
  // Structured scene (5 fields) — entered manually or produced by D0.
  sceneInput: jsonb("scene_input"),
  // D1 output: { scene_analysis, image_prompt, veo_prompt, intro_text }.
  visualFoundation: jsonb("visual_foundation"),
  // D1 output, split out so D2/D4 can re-inject it verbatim:
  // { ambient_bed, tonal_hum, rhythmic_texture, human_trace, silence_gap }.
  ambientSoundMap: jsonb("ambient_sound_map"),
  // D1 output, carried forward into D2A/B/C so the whole 20-track playlist
  // shares one tonal centre: { key_center, mode, tempo_anchor_bpm }.
  harmonicPalette: jsonb("harmonic_palette"),
  // D2A/B/C output appended in order — array of TrackSpec.
  trackSpecs: jsonb("track_specs"),
  // Suno results — array of EpisodeTrackAudio (one per spec, each with 1-2 clips).
  audio: jsonb("audio"),
  // Dedicated Suno ambience track (a single EpisodeTrackAudio) that the local
  // assembler loops underneath the whole mix. Not part of the 20-track playlist.
  ambientBedAudio: jsonb("ambient_bed_audio"),
  // Lease lock so only one cron cycle drives the Suno fan-out at a time
  // (a duplicate submit wastes real Suno credits). ISO timestamp string.
  sunoLock: timestamp("suno_lock", { withTimezone: true }),
  // D3 output: { strategy, nano_banana_prompt }.
  thumbnail: jsonb("thumbnail"),
  // D4 output (code assembles the final description/chapters from real durations).
  ytTitle: text("yt_title"),
  ytSlug: text("yt_slug"),
  ytDescription: text("yt_description"),
  ytTags: text("yt_tags"),
  ytChapters: jsonb("yt_chapters"),
  ytPinnedComment: text("yt_pinned_comment"),
  ytPlaylists: jsonb("yt_playlists"),
  // Local pipeline tracking (filled by the Mac worker; left empty for now).
  imagePath: text("image_path"),
  loopVideoPath: text("loop_video_path"),
  finalVideoPath: text("final_video_path"),
  // Publish marker — set manually once uploaded to YouTube.
  publishedAt: timestamp("published_at", { withTimezone: true }),
  youtubeUrl: text("youtube_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DrEpisode = typeof drEpisodes.$inferSelect;
export type NewDrEpisode = typeof drEpisodes.$inferInsert;

// ── Shape of the JSON payloads (stored as jsonb, typed in code) ──────────────

export interface SceneInput {
  scene_name: string;
  visual_highlights: string;
  atmosphere_mood: string;
  accent_color: string;
  music_role: string;
}

export interface AmbientSoundMap {
  ambient_bed: string;
  tonal_hum: string;
  rhythmic_texture: string;
  human_trace: string;
  silence_gap: string;
}

export interface HarmonicPalette {
  key_center: string; // e.g. "D minor"
  mode: string; // e.g. "dorian"
  tempo_anchor_bpm: number; // 40–84
}

export interface TrackSpec {
  title: string;
  role: string;
  youtube_use_case: string;
  style_tags: string;
  structure: string;
  mix_notes: string;
  transition_note: string;
}

export interface AudioClip {
  url: string;
  durationSec: number;
  fileName: string;
}

export interface EpisodeTrackAudio {
  specIndex: number;
  title: string;
  role: string;
  taskId: string | null;
  status: "pending" | "running" | "done" | "error";
  errorMessage?: string;
  clips: AudioClip[];
  // Index into clips[] chosen as the one that goes into the final video.
  // Set by the duration heuristic (suno.ts) or overridden manually from the
  // dashboard. -1 / undefined until clips arrive.
  primaryClipIndex?: number;
}

// ── Status machine ───────────────────────────────────────────────────────────

export const DR_STATUSES = [
  "d0_pending", // auto scene generation (optional entry point)
  "d1_pending",
  "d2a_pending",
  "d2b_pending",
  "d2c_pending",
  "suno_pending",
  "d3_pending",
  "d4_pending",
  "ready",
  "image_gen_pending",
  "assembly_pending",
  "assembly_done",
  "needs_attention",
] as const;

export type DrEpisodeStatus = (typeof DR_STATUSES)[number];

// Steps: Scene/Visual(0) Audio(1) Music(2) Thumbnail(3) Package(4) Images(5) Assemble(6) — 7 total
export const STATUS_STEP: Record<string, number> = {
  d0_pending: 0,
  d1_pending: 0,
  d2a_pending: 1,
  d2b_pending: 1,
  d2c_pending: 1,
  suno_pending: 2,
  d3_pending: 3,
  d4_pending: 4,
  ready: 5,
  image_gen_pending: 5,
  assembly_pending: 6,
  assembly_done: 7,
  needs_attention: -1,
};

export const STATUS_LABELS: Record<string, string> = {
  d0_pending: "Scene",
  d1_pending: "Visual",
  d2a_pending: "Audio 1-5",
  d2b_pending: "Audio 6-15",
  d2c_pending: "Audio 16-20",
  suno_pending: "Music",
  d3_pending: "Thumbnail",
  d4_pending: "Package",
  ready: "Ready",
  image_gen_pending: "Manual Assets",
  assembly_pending: "Assembling",
  assembly_done: "Done",
  needs_attention: "Failed",
};

export const STATUS_ACTIVE_STEP: Record<string, number> = {
  d0_pending: 0,
  d1_pending: 0,
  d2a_pending: 1,
  d2b_pending: 1,
  d2c_pending: 1,
  suno_pending: 2,
  d3_pending: 3,
  d4_pending: 4,
  ready: 5,
  image_gen_pending: 5,
  assembly_pending: 6,
  assembly_done: -1,
  needs_attention: -1,
};

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export const IN_PIPELINE_STATUSES: DrEpisodeStatus[] = [
  "d0_pending",
  "d1_pending",
  "d2a_pending",
  "d2b_pending",
  "d2c_pending",
  "suno_pending",
  "d3_pending",
  "d4_pending",
  "ready",
  "image_gen_pending",
  "assembly_pending",
];
