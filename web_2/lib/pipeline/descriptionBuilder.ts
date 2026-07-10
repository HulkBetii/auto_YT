import { z } from "zod";

import { channelConfig } from "@/lib/config/channel";

const FIXED_CHANNEL_TAGS = new Set([
  "ancient humans",
  "how ancient humans lived",
  "prehistoric life",
  "human evolution",
  "early humans",
  "stone age survival",
  "doodle animation",
  "the ancient you",
]);
const BANNED_HASHTAGS = new Set(["#viral", "#fyp", "#trending"]);
const MAX_DESCRIPTION_CHARS = 5000;
const MAX_TAGS = 10;
const MAX_TAGS_CHARS = 500;
const MAX_HASHTAG_LINE_CHARS = 60;

const S4VariableSchema = z
  .object({
    title: z.string().min(1),
    url_slug: z.string().min(1),
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
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`S4 output is missing/invalid required fields: ${issues}`);
  }
  return result.data;
}

export function normalizeUrlSlug(slug: string | null | undefined, fallbackTitle: string): string {
  const source = slug?.trim() || fallbackTitle;
  const normalized = source
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 8)
    .join("-");

  if (normalized) return normalized;
  return fallbackTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function splitTags(tags: string): string[] {
  return tags
    .split(",")
    .map((tag) => tag.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

export function normalizeVideoSpecificTags(tags: string): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of splitTags(tags)) {
    const key = tag.toLowerCase();
    if (FIXED_CHANNEL_TAGS.has(key) || seen.has(key)) continue;
    const candidate = [...out, tag].join(", ");
    if (out.length >= MAX_TAGS || candidate.length > MAX_TAGS_CHARS) break;
    seen.add(key);
    out.push(tag);
  }
  return out.join(", ");
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
  const starts = segments.map((segment) => segment.start);
  const snap = (target: number) =>
    starts.reduce((best, start) => (Math.abs(start - target) < Math.abs(best - target) ? start : best), starts[0]);

  const out: number[] = [0];
  for (let index = 1; index < count; index++) {
    const target = (index * total) / count;
    const timestamp = snap(target);
    if (timestamp - out[out.length - 1] >= MIN_CHAPTER_SPACING) out.push(timestamp);
  }
  return out;
}

export function fmtChapterTime(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export interface RelatedVideo {
  title: string;
  url: string;
}

function buildHashtagLine(hashtags: string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawHashtag of hashtags) {
    const hashtag = rawHashtag.trim().startsWith("#") ? rawHashtag.trim() : `#${rawHashtag.trim()}`;
    const normalized = hashtag.toLowerCase();
    if (!/^#[a-z0-9_]+$/i.test(hashtag) || BANNED_HASHTAGS.has(normalized) || seen.has(normalized)) continue;
    const candidate = [...out, hashtag].join(" ");
    if (out.length >= 5 || candidate.length > MAX_HASHTAG_LINE_CHARS) break;
    seen.add(normalized);
    out.push(hashtag);
  }
  return out.slice(0, Math.max(3, Math.min(out.length, 5))).join(" ");
}

/** Assembles the final YouTube description from LLM-generated variable copy + code-owned constants and real chapter timestamps. */
export function buildDescription(
  input: S4Variable,
  chapterTimes: number[],
  cfg: typeof channelConfig = channelConfig,
  relatedVideos: RelatedVideo[] = [],
): string {
  const DIV = "-".repeat(27);
  const parts: string[] = [];

  parts.push(input.hook_paragraph.trim());
  parts.push("");

  parts.push("In this video, you'll discover:");
  for (const bullet of input.discover_bullets.slice(0, 3)) parts.push(`- ${bullet}`);
  parts.push("");
  parts.push(
    "This episode of The Ancient You turns one ancient human problem into a clear, visual story: what happened, what evidence survives, and why it still matters to your body and mind today.",
  );
  parts.push(
    "Instead of treating prehistory like a list of dates, the story follows the choices, risks, tools, relationships, and body signals that shaped ordinary survival. The goal is simple: make the ancient scene easy to picture, then connect it back to the instincts you still carry into modern life as a viewer. It also gives the finished upload enough context for search without burying the opening hook, the chapter list, or the strongest search terms.",
  );
  parts.push("");

  const chapterCount = Math.min(input.chapter_titles.length, chapterTimes.length);
  if (chapterCount >= 3) {
    parts.push(DIV, "CHAPTERS", DIV);
    for (let index = 0; index < chapterCount; index++) {
      parts.push(`${fmtChapterTime(chapterTimes[index])} ${input.chapter_titles[index]}`);
    }
    parts.push("");
  }

  if (relatedVideos.length > 0 || cfg.playlistUrl) {
    parts.push(DIV, "MORE LIKE THIS", DIV);
    for (const relatedVideo of relatedVideos.slice(0, 3)) parts.push(`- ${relatedVideo.title}: ${relatedVideo.url}`);
    if (cfg.playlistUrl) parts.push(`- Full Playlist - Daily Life in Prehistory: ${cfg.playlistUrl}`);
    parts.push("");
  }

  parts.push(`Subscribe: ${cfg.channelUrl}${cfg.subConfirmSuffix}`);
  parts.push(cfg.uploadSchedule);
  parts.push("");

  if (cfg.affiliateEnabled) {
    parts.push(cfg.affiliateDisclosure, "");
  }

  parts.push(buildHashtagLine(cfg.hashtags));

  const description = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return description.length <= MAX_DESCRIPTION_CHARS ? description : description.slice(0, MAX_DESCRIPTION_CHARS).trim();
}
