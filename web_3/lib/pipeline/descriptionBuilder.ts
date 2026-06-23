import { z } from "zod";

import { channelConfig } from "@/lib/config/channel";
import type { AmbientSoundMap, EpisodeTrackAudio, SceneInput } from "@/lib/db/schema";

// D4 returns only the creative copy. The structured soundscape, music list,
// specs, chapters and hashtags are assembled in code so the LLM can't drift the
// channel's fixed identity or hallucinate chapter timing.
const D4VariableSchema = z
  .object({
    titles: z.array(z.string().min(1)).min(1),
    best_title: z.string().min(1),
    slug: z.string().min(1),
    pov_intro: z.string().min(1),
    scene_details: z.string().min(1),
    pinned_comment: z.string().min(1),
    hidden_tags: z.string().min(1),
    playlists: z.array(z.string().min(1)).min(1),
  })
  .passthrough();

export type D4Variable = z.infer<typeof D4VariableSchema>;

export function parseD4Variable(raw: unknown): D4Variable {
  const result = D4VariableSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`D4 output is missing/invalid required fields: ${issues}`);
  }
  return result.data;
}

export interface YouTubeChapter {
  time: string;
  title: string;
}

export function fmtChapterTime(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** Flattens the per-track audio into the ordered clip sequence that the final
 * video concatenates (every kept Suno clip becomes one segment). */
export function flattenClips(
  audio: EpisodeTrackAudio[],
): Array<{ title: string; durationSec: number }> {
  const out: Array<{ title: string; durationSec: number }> = [];
  for (const track of [...audio].sort((a, b) => a.specIndex - b.specIndex)) {
    if (track.specIndex === -1) continue; // ambient bed — underlay, not a playlist track
    if (track.clips.length === 0) continue;
    // One chapter per track using its chosen primary clip.
    const i =
      track.primaryClipIndex != null && track.primaryClipIndex >= 0 && track.primaryClipIndex < track.clips.length
        ? track.primaryClipIndex
        : 0;
    out.push({ title: track.title, durationSec: track.clips[i].durationSec });
  }
  return out;
}

/**
 * Builds chapters from the real primary-clip durations. Each crossfade overlaps
 * adjacent tracks by `crossfadeSec`, shrinking the timeline, so chapter i starts
 * at Σ(dur[0..i-1]) − i*crossfadeSec to match the assembled audio.
 */
export function buildChaptersFromAudio(
  audio: EpisodeTrackAudio[],
  crossfadeSec = 0,
): YouTubeChapter[] {
  const clips = flattenClips(audio);
  const chapters: YouTubeChapter[] = [];
  let cursor = 0;
  let lastStart = -1;
  clips.forEach((clip, i) => {
    const start = Math.max(lastStart + 1, Math.max(0, cursor - i * crossfadeSec));
    chapters.push({ time: fmtChapterTime(start), title: clip.title });
    lastStart = start;
    cursor += clip.durationSec;
  });
  return chapters;
}

// Code-owned constants — the fixed channel identity that must never drift.
const MUSIC_INSTRUMENTS = [
  "smoky saxophone",
  "muted trumpet",
  "upright bass",
  "brushed drums",
  "Rhodes electric piano",
  "sparse noir piano",
  "vinyl crackle",
  "tape hiss",
  "subtle 16-bit retro texture",
];

const DESIGNED_FOR =
  "coding, studying, writing, focusing, sleeping, relaxing, rainy nights, noir ambience, and drifting through the digital city.";

const DIV = "━".repeat(27);

/** Assembles the final YouTube description from D4 copy + code-owned constants,
 * real ambient sound map, and real chapter timestamps. */
export function buildDescription(
  v: D4Variable,
  scene: SceneInput,
  ambient: AmbientSoundMap,
  chapters: YouTubeChapter[],
  cfg: typeof channelConfig = channelConfig,
): string {
  const parts: string[] = [];

  parts.push(v.pov_intro.trim());
  parts.push("");

  parts.push("🎧 THE SOUNDSCAPE:");
  parts.push("Immerse yourself in the late-night sounds of:");
  for (const line of [
    ambient.ambient_bed,
    ambient.tonal_hum,
    ambient.rhythmic_texture,
    ambient.human_trace,
    ambient.silence_gap,
  ]) {
    if (line?.trim()) parts.push(`• ${line.trim()}`);
  }
  parts.push("");

  parts.push("🎷 THE MUSIC:");
  parts.push("A slow Cyberpunk Noir Dark Jazz session featuring:");
  for (const inst of MUSIC_INSTRUMENTS) parts.push(`• ${inst}`);
  parts.push("");

  parts.push("💡 SCENE DETAILS:");
  parts.push(v.scene_details.trim());
  parts.push("");
  parts.push(`Designed for:\n${DESIGNED_FOR}`);
  parts.push("");

  if (chapters.length >= 3) {
    parts.push(DIV, "⏱️ CHAPTERS", DIV);
    for (const ch of chapters) parts.push(`${ch.time} ${ch.title}`);
    parts.push("");
  }

  parts.push("📋 SPECS:");
  parts.push("Visuals:  Strict 16-bit Cyberpunk Noir Pixel Art");
  parts.push("Audio:    Custom Dark Jazz / Noir Jazz / Doom Jazz Instrumental Session");
  parts.push(`Vibe:     ${scene.atmosphere_mood}`);
  parts.push("");

  parts.push(`🔔 Subscribe: ${cfg.channelUrl}${cfg.subConfirmSuffix}`);
  parts.push(cfg.uploadSchedule);
  parts.push("");

  parts.push(cfg.hashtags.slice(0, 5).join(" "));

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
