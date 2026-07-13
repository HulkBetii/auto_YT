import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

const RENDER_ROOT = path.resolve(process.cwd(), "data", "renders");

export type ByteRange = {
  start: number;
  end: number;
};

function assertVideoId(videoId: number) {
  if (!Number.isSafeInteger(videoId) || videoId <= 0) {
    throw new Error(`Invalid video id: ${videoId}`);
  }
}

export function getRenderDirectory(videoId: number) {
  assertVideoId(videoId);
  const directory = path.resolve(RENDER_ROOT, String(videoId));
  if (!directory.startsWith(`${RENDER_ROOT}${path.sep}`)) {
    throw new Error("Render path escapes the configured render root");
  }
  return directory;
}

export function getRenderedVideoPath(videoId: number) {
  return path.join(getRenderDirectory(videoId), "final_video.mp4");
}

export function getRenderedSubtitlePath(videoId: number) {
  return path.join(getRenderDirectory(videoId), "subtitles.srt");
}

export function getRenderedChaptersPath(videoId: number) {
  return path.join(getRenderDirectory(videoId), "chapters.json");
}

export function parseByteRange(
  rangeHeader: string,
  fileSize: number,
): ByteRange | null {
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    const length = Math.min(suffixLength, fileSize);
    return { start: fileSize - length, end: fileSize - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), fileSize - 1) : fileSize - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= fileSize
  ) {
    return null;
  }
  return { start, end };
}

async function renderedFileExists(filePath: string) {
  try {
    const file = await stat(filePath);
    return file.isFile() && file.size > 0;
  } catch {
    return false;
  }
}

export async function renderedVideoExists(videoId: number) {
  return renderedFileExists(getRenderedVideoPath(videoId));
}

export async function renderedSubtitleExists(videoId: number) {
  return renderedFileExists(getRenderedSubtitlePath(videoId));
}

function formatChapterTimestamp(seconds: number) {
  const totalSeconds = Math.max(Math.floor(seconds), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secondsPart = totalSeconds % 60;
  if (hours > 0) {
    return [hours, minutes, secondsPart]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  }
  return `${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`;
}

export async function readResolvedChapterLines(
  videoId: number,
): Promise<string | null> {
  try {
    const payload = JSON.parse(
      await readFile(getRenderedChaptersPath(videoId), "utf8"),
    ) as {
      duration_seconds?: unknown;
      chapters?: Array<{
        title?: unknown;
        resolved_seconds?: unknown;
        seconds?: unknown;
      }>;
    };
    const duration =
      typeof payload.duration_seconds === "number" &&
      Number.isFinite(payload.duration_seconds) &&
      payload.duration_seconds > 0
        ? payload.duration_seconds
        : Number.POSITIVE_INFINITY;
    const chapters = (payload.chapters ?? []).map((chapter) => ({
      title: typeof chapter.title === "string" ? chapter.title.trim() : "",
      seconds:
        typeof chapter.resolved_seconds === "number"
          ? chapter.resolved_seconds
          : chapter.seconds,
    }));
    if (chapters.length < 3) return null;

    let previousSeconds = -10;
    const lines: string[] = [];
    for (const chapter of chapters) {
      if (
        !chapter.title ||
        typeof chapter.seconds !== "number" ||
        !Number.isFinite(chapter.seconds) ||
        chapter.seconds < 0 ||
        chapter.seconds > duration ||
        chapter.seconds - previousSeconds < 10
      ) {
        return null;
      }
      lines.push(
        `${formatChapterTimestamp(chapter.seconds)} ${chapter.title.replace(/\s+/g, " ")}`,
      );
      previousSeconds = chapter.seconds;
    }
    if (!lines[0].startsWith("00:00 ")) return null;
    return lines.join("\n");
  } catch {
    return null;
  }
}

export async function removeRenderArtifacts(videoId: number) {
  await rm(getRenderDirectory(videoId), { recursive: true, force: true });
}
