import { rm, stat } from "node:fs/promises";
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

export async function renderedVideoExists(videoId: number) {
  try {
    const file = await stat(getRenderedVideoPath(videoId));
    return file.isFile() && file.size > 0;
  } catch {
    return false;
  }
}

export async function removeRenderArtifacts(videoId: number) {
  await rm(getRenderDirectory(videoId), { recursive: true, force: true });
}
