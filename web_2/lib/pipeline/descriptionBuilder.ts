import { z } from "zod";

import { channelConfig } from "@/lib/config/channel";

const S4VariableSchema = z
  .object({
    title: z.string().min(1),
    hook_paragraph: z.string().min(1),
    discover_bullets: z.array(z.string()).min(1),
    chapter_titles: z.array(z.string()).min(1),
    tags: z.string().min(1),
    thumbnail: z
      .object({
        concept: z.string().min(1),
        text: z.string(),
        emotion: z.string(),
        accent_color: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

export type S4Variable = z.infer<typeof S4VariableSchema>;

/** Parses + validates the LLM's S4 JSON. Throws a clear, named-field error on missing/invalid data instead of failing silently downstream. */
export function parseS4Variable(raw: unknown): S4Variable {
  const result = S4VariableSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`S4 output is missing/invalid required fields: ${issues}`);
  }
  return result.data;
}

export interface WhisperSegment {
  start: number;
  text: string;
}

/** Parses the stored "[MM:SS] text" whisper transcript into {start, text} segments. */
export function parseWhisperSegments(whisperTranscript: string | null | undefined): WhisperSegment[] {
  if (!whisperTranscript) return [];
  return whisperTranscript
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^\[(\d{1,2}):(\d{2})(?::\d{2})?\]\s*(.*)$/);
      if (!match) return null;
      const start = Number(match[1]) * 60 + Number(match[2]);
      return Number.isFinite(start) ? { start, text: match[3]?.trim() ?? "" } : null;
    })
    .filter((segment): segment is WhisperSegment => segment != null);
}

const MIN_CHAPTER_SPACING = 10;

/**
 * Picks `count` real Whisper segment start times spread evenly across the
 * video, snapped to actual segment boundaries (never invented), starting at
 * 0:00 and enforcing YouTube's >=10s minimum chapter spacing.
 */
export function computeChapterTimestamps(segments: { start: number }[], count: number): number[] {
  if (segments.length === 0 || count <= 0) return [0];

  const total = segments[segments.length - 1].start;
  const starts = segments.map((s) => s.start);
  const snap = (target: number) =>
    starts.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), starts[0]);

  const out: number[] = [0];
  for (let i = 1; i < count; i++) {
    const target = (i * total) / count;
    const t = snap(target);
    if (t - out[out.length - 1] >= MIN_CHAPTER_SPACING) out.push(t);
  }
  return out;
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

export interface RelatedVideo {
  title: string;
  url: string;
}

/** Assembles the final YouTube description from LLM-generated variable copy + code-owned constants and real chapter timestamps. */
export function buildDescription(
  v: S4Variable,
  chapterTimes: number[],
  cfg: typeof channelConfig = channelConfig,
  relatedVideos: RelatedVideo[] = [],
): string {
  const DIV = "━".repeat(27);
  const parts: string[] = [];

  parts.push(v.hook_paragraph.trim());
  parts.push("");

  parts.push("In this video, you'll discover:");
  for (const b of v.discover_bullets.slice(0, 3)) parts.push(`✅ ${b}`);
  parts.push("");

  const n = Math.min(v.chapter_titles.length, chapterTimes.length);
  if (n >= 3) {
    parts.push(DIV, "⏱️ CHAPTERS", DIV);
    for (let i = 0; i < n; i++) {
      parts.push(`${fmtChapterTime(chapterTimes[i])} ${v.chapter_titles[i]}`);
    }
    parts.push("");
  }

  if (relatedVideos.length > 0 || cfg.playlistUrl) {
    parts.push(DIV, "📺 MORE LIKE THIS", DIV);
    for (const r of relatedVideos.slice(0, 3)) parts.push(`→ ${r.title}: ${r.url}`);
    if (cfg.playlistUrl) parts.push(`→ Full Playlist — Daily Life in Prehistory: ${cfg.playlistUrl}`);
    parts.push("");
  }

  if (cfg.affiliateEnabled) {
    parts.push(cfg.affiliateDisclosure, "");
  }

  parts.push(`🔔 Subscribe: ${cfg.channelUrl}${cfg.subConfirmSuffix}`);
  parts.push(cfg.uploadSchedule);
  parts.push("");

  parts.push(cfg.hashtags.slice(0, 3).join(" "));

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
