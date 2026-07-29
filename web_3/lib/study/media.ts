import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  StudyAudioTrackFile,
  StudyAudioTrackManifest,
  StudyFootageFile,
  StudyFootageManifest,
} from "@/lib/db/schema";
import {
  STUDY_AUDIO_CROSSFADE_SEC,
  STUDY_TRACKS_PER_WEEK,
} from "@/lib/study/project";

const execFileAsync = promisify(execFile);
const TARGET_ASPECT_RATIO = 16 / 9;
const ASPECT_RATIO_TOLERANCE = 0.02;
const REQUIRED_FREE_SPACE_MULTIPLIER = 2.5;
export const STUDY_MASTER_PROFILE = "study-master-v1";
export const STUDY_ASSEMBLY_PROFILE = "study-pomodoro-v2";

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
}

interface FfprobeResult {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

export function naturalSort(values: string[]): string[] {
  return [...values].sort(compareNaturalFileNames);
}

function naturalFileNameParts(value: string): Array<number | string> {
  return value
    .split(/(\d+)/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}

function compareNaturalFileNames(left: string, right: string): number {
  const leftParts = naturalFileNameParts(left);
  const rightParts = naturalFileNameParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "string") return -1;
    if (typeof leftPart === "string" && typeof rightPart === "number") return 1;
    return leftPart < rightPart ? -1 : 1;
  }

  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (normalizedLeft !== normalizedRight) {
    return normalizedLeft < normalizedRight ? -1 : 1;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function parseFrameRate(value: string | undefined): number {
  if (!value) return 0;
  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

export function isSixteenByNine(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  const relativeError = Math.abs(width / height - TARGET_ASPECT_RATIO) / TARGET_ASPECT_RATIO;
  return relativeError <= ASPECT_RATIO_TOLERANCE;
}

export function requiredFreeBytes(totalFootageBytes: number): number {
  return Math.ceil(totalFootageBytes * REQUIRED_FREE_SPACE_MULTIPLIER);
}

export function createStudyInputSignature(
  input: {
    dayNumber: number;
    weekNumber: number;
    footageSha256s: string[];
    trackSha256s: string[];
  },
  assemblyProfile = STUDY_ASSEMBLY_PROFILE,
): string {
  const payload = {
    assemblyProfile,
    dayNumber: input.dayNumber,
    weekNumber: input.weekNumber,
    footageSha256s: input.footageSha256s,
    trackSha256s: input.trackSha256s,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createStudyMasterSignature(
  footageSha256s: string[],
  masterProfile = STUDY_MASTER_PROFILE,
): string {
  const payload = {
    masterProfile,
    footageSha256s,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function probeMedia(filePath: string): Promise<FfprobeResult> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels,duration",
      "-of",
      "json",
      filePath,
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as FfprobeResult;
}

function mediaDurationSec(probe: FfprobeResult, stream?: FfprobeStream): number {
  const duration = Number(probe.format?.duration || stream?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Media duration is missing or invalid");
  return duration;
}

function relativeMediaPath(mediaRoot: string, filePath: string): string {
  const relative = path.relative(mediaRoot, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Media path is outside STUDY_MEDIA_ROOT: ${filePath}`);
  }
  return relative.replaceAll("\\", "/");
}

async function listRegularFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return naturalSort(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
}

export async function scanStudyAudioTracks(
  audioDir: string,
  mediaRoot: string,
): Promise<StudyAudioTrackManifest> {
  const fileNames = await listRegularFiles(audioDir);
  const unsupported = fileNames.filter((name) => path.extname(name).toLowerCase() !== ".mp3");
  if (unsupported.length > 0) {
    throw new Error(`Audio folder contains unsupported files: ${unsupported.join(", ")}`);
  }
  if (fileNames.length !== STUDY_TRACKS_PER_WEEK) {
    throw new Error(`Audio week must contain exactly ${STUDY_TRACKS_PER_WEEK} MP3 files`);
  }

  const files: StudyAudioTrackFile[] = [];
  for (const fileName of fileNames) {
    const filePath = path.join(audioDir, fileName);
    const [fileStat, sha256, probe] = await Promise.all([
      stat(filePath),
      sha256File(filePath),
      probeMedia(filePath),
    ]);
    const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
    if (!audioStream?.codec_name) throw new Error(`${fileName} has no valid audio stream`);
    const durationSec = mediaDurationSec(probe, audioStream);
    if (durationSec <= STUDY_AUDIO_CROSSFADE_SEC) {
      throw new Error(
        `${fileName} must be longer than the ${STUDY_AUDIO_CROSSFADE_SEC}s crossfade`,
      );
    }
    files.push({
      fileName,
      relativePath: relativeMediaPath(mediaRoot, filePath),
      sha256,
      sizeBytes: fileStat.size,
      durationSec,
      codecName: audioStream.codec_name,
      sampleRate: audioStream.sample_rate ? Number(audioStream.sample_rate) : null,
      channels: audioStream.channels ?? null,
    });
  }
  return { files, scannedAt: new Date().toISOString() };
}

export async function scanStudyFootage(
  sourceDir: string,
  mediaRoot: string,
): Promise<StudyFootageManifest> {
  const fileNames = await listRegularFiles(sourceDir);
  if (fileNames.length === 0) throw new Error("Footage source folder is empty");
  const unsupported = fileNames.filter((name) => path.extname(name).toLowerCase() !== ".mp4");
  if (unsupported.length > 0) {
    throw new Error(`Footage folder contains unsupported files: ${unsupported.join(", ")}`);
  }

  const files: StudyFootageFile[] = [];
  for (const fileName of fileNames) {
    const filePath = path.join(sourceDir, fileName);
    const [fileStat, sha256, probe] = await Promise.all([
      stat(filePath),
      sha256File(filePath),
      probeMedia(filePath),
    ]);
    const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
    if (!videoStream?.codec_name || !videoStream.width || !videoStream.height) {
      throw new Error(`${fileName} has no valid video stream`);
    }
    if (!isSixteenByNine(videoStream.width, videoStream.height)) {
      throw new Error(`${fileName} must be 16:9 (found ${videoStream.width}x${videoStream.height})`);
    }
    const frameRate = parseFrameRate(videoStream.avg_frame_rate || videoStream.r_frame_rate);
    if (frameRate <= 0) throw new Error(`${fileName} has an invalid frame rate`);
    files.push({
      fileName,
      relativePath: relativeMediaPath(mediaRoot, filePath),
      sha256,
      sizeBytes: fileStat.size,
      durationSec: mediaDurationSec(probe, videoStream),
      width: videoStream.width,
      height: videoStream.height,
      frameRate,
      codecName: videoStream.codec_name,
      hasAudio: Boolean(probe.streams?.some((stream) => stream.codec_type === "audio")),
    });
  }

  const uniqueHashes = new Set(files.map((file) => file.sha256));
  if (uniqueHashes.size !== files.length) throw new Error("Footage folder contains duplicate files");
  return { files, scannedAt: new Date().toISOString() };
}

export async function assertSufficientStudyDiskSpace(
  targetDirectory: string,
  totalFootageBytes: number,
): Promise<void> {
  const disk = await statfs(targetDirectory);
  const availableBytes = disk.bavail * disk.bsize;
  const requiredBytes = requiredFreeBytes(totalFootageBytes);
  if (availableBytes < requiredBytes) {
    throw new Error(`Insufficient disk space: requires ${requiredBytes} bytes, available ${availableBytes}`);
  }
}
