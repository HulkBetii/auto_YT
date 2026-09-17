/**
 * Audio and video file naming utilities for web_ko_jp.
 * Ensures consistent, clean, filesystem-safe and URL-safe filenames.
 */

/**
 * Normalizes title into an alphanumeric slug.
 * Removes Vietnamese diacritics, strips illegal characters (: \ / ? * " < > | % # & +),
 * and collapses multiple underscores.
 */
export function slugifyTitle(
  title?: string | null,
  maxWords = 6,
  maxChars = 35,
): string {
  if (!title) return "narration";

  // 1. Decompose unicode accents and remove combining diacritical marks
  let s = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");

  // 2. Replace illegal filename/URL chars with underscore (keep latin, numbers, Japanese kana/kanji)
  s = s.replace(/[^\w\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+/g, "_");

  // 3. Trim leading/trailing underscores and collapse multiple underscores
  s = s.replace(/^_+|_+$/g, "").replace(/_+/g, "_");

  if (!s) return "narration";

  // 4. Limit to first maxWords
  const parts = s.split("_").filter(Boolean);
  if (parts.length > maxWords) {
    s = parts.slice(0, maxWords).join("_");
  }

  // 5. Limit string length
  if (s.length > maxChars) {
    s = s.slice(0, maxChars).replace(/_+$/, "");
  }

  return s || "narration";
}

/**
 * Extracts standard 11-character YouTube video ID from various URL formats.
 */
export function extractYouTubeId(url?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/(?:v=|\/|embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

export interface VideoNamingParams {
  videoId?: number | null;
  sourceVideoId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  timestamp?: number | null;
}

/**
 * Common base slug for a video:
 * Format: v{id}_{yt_id}_{slug} (or {yt_id}_{slug}_{ts} if no id)
 */
export function buildVideoBaseName(params: VideoNamingParams): string {
  const { videoId, sourceVideoId, sourceUrl, title, timestamp } = params;
  const ts = timestamp !== undefined && timestamp !== null ? timestamp : Date.now();

  const ytId = sourceVideoId || extractYouTubeId(sourceUrl);
  const slug = slugifyTitle(title);

  const parts: string[] = [];

  if (videoId !== undefined && videoId !== null) {
    parts.push(`v${videoId}`);
  }

  if (ytId) {
    parts.push(ytId);
  }

  if (slug && slug !== "narration") {
    parts.push(slug);
  } else if (parts.length === 0) {
    parts.push("video");
  }

  if (videoId === undefined || videoId === null) {
    parts.push(ts.toString());
  }

  return parts.join("_");
}

/**
 * Builds standard filename for Japanese drama TTS narration (.wav).
 * Format: drama_v{id}_{yt_id}_{slug}.wav
 */
export function buildDramaAudioFilename(params: VideoNamingParams): string {
  return `drama_${buildVideoBaseName(params)}.wav`;
}

/**
 * Builds standard filename for generated YouTube thumbnail image (.png).
 * Format: thumb_v{id}_{yt_id}_{slug}.png
 */
export function buildThumbnailFilename(params: VideoNamingParams): string {
  return `thumb_${buildVideoBaseName(params)}.png`;
}

/**
 * Builds standard filename for exported package/summary text (.txt).
 * Format: summary_v{id}_{yt_id}_{slug}.txt
 */
export function buildSummaryTxtFilename(params: VideoNamingParams): string {
  return `summary_${buildVideoBaseName(params)}.txt`;
}

/**
 * Builds standard filename for full video JSON data (.json).
 * Format: data_v{id}_{yt_id}_{slug}.json
 */
export function buildDataJsonFilename(params: VideoNamingParams): string {
  return `data_${buildVideoBaseName(params)}.json`;
}

/**
 * Builds standard filename for video subtitles (.srt).
 * Format: sub_v{id}_{yt_id}_{slug}.srt
 */
export function buildSrtFilename(params: VideoNamingParams): string {
  return `sub_${buildVideoBaseName(params)}.srt`;
}

/**
 * Returns the folder name for a specific video.
 * Format: v{id}_{yt_id}_{slug}
 */
export function getVideoFolderName(params: VideoNamingParams): string {
  return buildVideoBaseName(params);
}

/**
 * Returns all asset filenames and folder name for a specific video.
 */
export function getVideoAssetFilenames(params: VideoNamingParams) {
  const folderName = buildVideoBaseName(params);
  return {
    folderName,
    audioFileName: `drama_${folderName}.wav`,
    thumbFileName: `thumb_${folderName}.png`,
    summaryFileName: `summary_${folderName}.txt`,
    dataFileName: `data_${folderName}.json`,
    srtFileName: `sub_${folderName}.srt`,
  };
}
