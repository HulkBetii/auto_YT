import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TranscriptArtifact } from "@/lib/pipeline/yt-pro-max";

export function koDataRoot(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "data", "ko");
}

export function koVideoDataDir(videoId: number): string {
  if (!Number.isInteger(videoId) || videoId <= 0) throw new Error("Invalid video ID.");
  return path.join(koDataRoot(), String(videoId));
}

export async function writeSourceTranscript(videoId: number, title: string, body: string) {
  const directory = koVideoDataDir(videoId);
  await mkdir(directory, { recursive: true });
  const content = `Title: ${title.trim()}\n\n${body.trim()}\n`;
  const filePath = path.join(directory, "source.txt");
  await writeFile(filePath, content, "utf8");
  return {
    filePath,
    hash: createHash("sha256").update(content).digest("hex"),
  };
}

function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = milliseconds % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function renderTimestampedTranscript(artifact: TranscriptArtifact): string {
  return artifact.segments
    .map(
      (segment) =>
        `[SEGMENT ${String(segment.index).padStart(4, "0")} | ${formatTimestamp(segment.start_ms)}-${formatTimestamp(segment.end_ms)}] ${segment.text}`,
    )
    .join("\n");
}

export async function writeRawTranscript(
  videoId: number,
  title: string,
  rawBody: string,
  artifact: TranscriptArtifact,
) {
  const directory = koVideoDataDir(videoId);
  await mkdir(directory, { recursive: true });
  const txtPath = path.join(directory, "source.raw.txt");
  const jsonPath = path.join(directory, "source.raw.json");
  const timestamped = renderTimestampedTranscript(artifact);
  await Promise.all([
    writeFile(txtPath, `Title: ${title.trim()}\n\n${timestamped}\n`, "utf8"),
    writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
  ]);
  return { txtPath, jsonPath, rawBody: rawBody.trim() };
}

export async function readRawTranscriptArtifact(filePath: string): Promise<TranscriptArtifact> {
  return JSON.parse(await readFile(filePath, "utf8")) as TranscriptArtifact;
}

export async function writeFinalScript(videoId: number, script: string) {
  const directory = koVideoDataDir(videoId);
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, "final.txt");
  await writeFile(filePath, `${script.trim()}\n`, "utf8");
  return filePath;
}
