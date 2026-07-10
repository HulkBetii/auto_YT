import { listAhVideos, updateAhVideoFields } from "@/lib/db/repo/videos";
import type { AhVideo, BgmStatus } from "@/lib/db/schema";

export const BGM_PROVIDER = "ai33_suno";
export const BGM_ZONES = ["hook", "main", "ending"] as const;
export const MAX_SUNO_PROMPT_LENGTH = 500;

const SUNO_MUSIC_URL = "https://api.ai33.pro/v1s/task/music-generation";
const AI33_TASK_URL = "https://api.ai33.pro/v1/task";

const BGM_START_STATUSES = new Set([
  "tts_pending",
  "s3_pending",
  "s4_pending",
  "ready",
  "image_gen_pending",
  "assembly_pending",
]);

const INSTRUMENTAL_LOCK =
  "Instrumental only, no vocals, no lyrics, no choir, no humming. Seamless loop documentary background underscore, narration-friendly.";
const MIX_LOCK = "No lead melody, no chorus, no trailer hits, low intensity.";

export type BgmZone = (typeof BGM_ZONES)[number];

export interface BgmPlanZone {
  zone: BgmZone;
  weight: number;
  prompt: string;
}

export interface BgmPlan {
  version: 1;
  provider: typeof BGM_PROVIDER;
  zones: BgmPlanZone[];
}

export interface BgmTrack {
  zone: BgmZone;
  status: "pending" | "doing" | "done" | "error";
  taskId?: string;
  prompt: string;
  audioUrl?: string;
  duration?: number;
  creditCost?: number;
  errorMessage?: string;
}

interface SunoCreateResponse {
  success?: boolean;
  task_id?: string;
  ec_remain_credits?: string;
}

interface SunoClip {
  audio_url?: unknown;
  duration?: unknown;
}

export interface SunoTaskResponse {
  id?: string;
  status?: string;
  error_message?: string | null;
  credit_cost?: number;
  metadata?: {
    audio_url?: unknown;
    all_audio_urls?: unknown;
    suno_result?: {
      clips?: SunoClip[];
    };
  };
}

export interface ParsedSunoTask {
  status: "doing" | "done" | "error";
  audioUrl?: string;
  duration?: number;
  creditCost?: number;
  errorMessage?: string;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compact(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const text = normalizeSpace(value).replace(/[<>]/g, "");
  return text.length <= maxLength ? text : text.slice(0, maxLength).trim();
}

function topicField(value: unknown, field: string, maxLength: number): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return compact((value as Record<string, unknown>)[field], maxLength);
}

function getProfileText(promptSetVersion: string, zone: BgmZone): string {
  if (promptSetVersion.startsWith("2.2")) {
    if (zone === "hook") return "quiet behavioral tension, cautious animal-human curiosity, not horror.";
    if (zone === "ending") return "calm reflective animal-human insight, cautious warmth, soft release.";
    return "observational behavior documentary, subtle unease, species interaction clarity.";
  }

  if (promptSetVersion.startsWith("2.3")) {
    if (zone === "hook") return "clean explanatory puzzle mood, soft pulse, crisp curiosity.";
    if (zone === "ending") return "clear system-resolution mood, gentle warmth, thoughtful closure.";
    return "neutral mechanism clarity, soft pulse, minimal ambient texture.";
  }

  if (zone === "hook") return "curious ancient-human mystery, soft earthy tension.";
  if (zone === "ending") return "warm modern mirror, gentle reflective ancient-human closure.";
  return "ancient-human documentary explanation, soft organic percussion, low drone.";
}

function getZoneIntent(zone: BgmZone): string {
  if (zone === "hook") return "For the opening hook: quiet curiosity and restrained tension.";
  if (zone === "ending") return "For the ending: warm reflective closure without drama.";
  return "For the main explanation: steady evidence and mechanism clarity.";
}

function fitSunoPrompt(parts: string[]): string {
  const prompt = normalizeSpace(parts.filter(Boolean).join(" "));
  if (prompt.length <= MAX_SUNO_PROMPT_LENGTH) return prompt;

  const required = `${INSTRUMENTAL_LOCK} ${MIX_LOCK}`;
  const optional = normalizeSpace(parts.slice(1, -1).join(" "));
  const available = MAX_SUNO_PROMPT_LENGTH - required.length - 1;
  const trimmedOptional = available > 0 ? optional.slice(0, available).trim() : "";
  return normalizeSpace(`${INSTRUMENTAL_LOCK} ${trimmedOptional} ${MIX_LOCK}`);
}

export function buildBgmPlan(video: Pick<AhVideo, "promptSetVersion" | "chosenTopic" | "script" | "ytChapters">): BgmPlan {
  const title = topicField(video.chosenTopic, "title", 90);
  const angle = topicField(video.chosenTopic, "angle", 120);
  const hook = topicField(video.chosenTopic, "hook", 90);
  const topicSummary = compact([title, angle || hook].filter(Boolean).join(" - "), 180);
  const scriptHint = compact(video.script, 120);
  const context = compact(topicSummary || scriptHint || "ancient human explainer", 180);

  const zoneSeeds: Array<{ zone: BgmZone; weight: number }> = [
    { zone: "hook", weight: 0.15 },
    { zone: "main", weight: 0.7 },
    { zone: "ending", weight: 0.15 },
  ];

  const zones: BgmPlanZone[] = zoneSeeds.map((zone) => ({
    ...zone,
    prompt: fitSunoPrompt([
      INSTRUMENTAL_LOCK,
      getZoneIntent(zone.zone),
      getProfileText(video.promptSetVersion, zone.zone),
      `Topic: ${context}.`,
      MIX_LOCK,
    ]),
  }));

  return {
    version: 1,
    provider: BGM_PROVIDER,
    zones,
  };
}

export function buildInitialBgmTracks(plan: BgmPlan): BgmTrack[] {
  return plan.zones.map((zone) => ({
    zone: zone.zone,
    status: "pending",
    prompt: zone.prompt,
  }));
}

export function parseSunoTaskResult(task: SunoTaskResponse): ParsedSunoTask {
  if (task.status === "done") {
    const audio = getSunoAudio(task);
    if (!audio.audioUrl) {
      return {
        status: "error",
        errorMessage: `Suno task ${task.id ?? ""} done but no audio_url`,
        creditCost: task.credit_cost,
      };
    }
    return {
      status: "done",
      audioUrl: audio.audioUrl,
      duration: audio.duration,
      creditCost: task.credit_cost,
    };
  }

  if (task.status === "error") {
    return {
      status: "error",
      errorMessage: task.error_message ?? "Suno task failed",
      creditCost: task.credit_cost,
    };
  }

  return {
    status: "doing",
    creditCost: task.credit_cost,
  };
}

function getSunoAudio(task: SunoTaskResponse): { audioUrl?: string; duration?: number } {
  const metadata = task.metadata;
  const clips = metadata?.suno_result?.clips ?? [];
  const metadataUrl = typeof metadata?.audio_url === "string" ? metadata.audio_url : undefined;
  const allAudioUrl = Array.isArray(metadata?.all_audio_urls)
    ? metadata.all_audio_urls.find((url): url is string => typeof url === "string" && url.trim().length > 0)
    : undefined;
  const clip = clips.find((item) => typeof item.audio_url === "string" && item.audio_url.trim().length > 0);
  const audioUrl = metadataUrl ?? allAudioUrl ?? (clip?.audio_url as string | undefined);
  const duration =
    clip && typeof clip.duration === "number" && Number.isFinite(clip.duration)
      ? clip.duration
      : undefined;
  return { audioUrl, duration };
}

async function submitSunoMusic(prompt: string): Promise<string> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) throw new Error("[bgm] VIVOO_API_KEY env var is not set");

  const res = await fetch(SUNO_MUSIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      create_mode: "simple",
      gpt_description_prompt: prompt,
      make_instrumental: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[bgm] submit Suno HTTP ${res.status}: ${body}`);
  }

  const json = (await res.json()) as SunoCreateResponse;
  if (!json.task_id) {
    throw new Error(`[bgm] submit Suno: no task_id in response: ${JSON.stringify(json)}`);
  }
  return json.task_id;
}

async function pollSunoMusic(taskId: string): Promise<ParsedSunoTask> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) return { status: "error", errorMessage: "[bgm] VIVOO_API_KEY env var is not set" };

  const res = await fetch(`${AI33_TASK_URL}/${taskId}`, {
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { status: "error", errorMessage: `[bgm] poll Suno HTTP ${res.status}: ${body}` };
  }

  return parseSunoTaskResult((await res.json()) as SunoTaskResponse);
}

function canStartBgm(video: AhVideo): boolean {
  return BGM_START_STATUSES.has(video.status) && !!video.script;
}

function canPollBgm(video: AhVideo): boolean {
  return !!video.script;
}

function getBgmStatus(video: AhVideo): BgmStatus {
  const status = video.bgmStatus as BgmStatus | null;
  return status ?? "not_started";
}

async function startBgmForVideo(video: AhVideo): Promise<void> {
  const plan = buildBgmPlan(video);
  const tracks = buildInitialBgmTracks(plan);

  await updateAhVideoFields(video.id, {
    bgmStatus: "submitting",
    bgmPlan: plan as unknown as Record<string, unknown>,
    bgmTracks: tracks as unknown as Record<string, unknown>[],
    bgmError: null,
  });

  try {
    for (const track of tracks) {
      track.taskId = await submitSunoMusic(track.prompt);
      track.status = "doing";
      await updateAhVideoFields(video.id, {
        bgmTracks: tracks as unknown as Record<string, unknown>[],
        bgmStatus: "generating",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateAhVideoFields(video.id, {
      bgmStatus: "failed",
      bgmTracks: tracks as unknown as Record<string, unknown>[],
      bgmError: message,
    });
  }
}

async function pollBgmForVideo(video: AhVideo): Promise<void> {
  const tracks = Array.isArray(video.bgmTracks) ? (video.bgmTracks as unknown as BgmTrack[]) : [];
  if (tracks.length === 0) {
    await updateAhVideoFields(video.id, { bgmStatus: "not_started" });
    return;
  }

  let hasError = false;
  let hasRunning = false;

  for (const track of tracks) {
    if (track.status === "done" || track.status === "error") {
      if (track.status === "error") hasError = true;
      continue;
    }
    if (!track.taskId) {
      hasRunning = true;
      continue;
    }

    const result = await pollSunoMusic(track.taskId);
    if (result.status === "done") {
      track.status = "done";
      track.audioUrl = result.audioUrl;
      track.duration = result.duration;
      track.creditCost = result.creditCost;
    } else if (result.status === "error") {
      track.status = "error";
      track.errorMessage = result.errorMessage;
      track.creditCost = result.creditCost;
      hasError = true;
    } else {
      hasRunning = true;
    }
  }

  const nextStatus: BgmStatus = hasError
    ? "failed"
    : hasRunning
      ? "generating"
      : "ready";
  const error = hasError
    ? tracks.find((track) => track.status === "error")?.errorMessage ?? "Suno BGM failed"
    : null;

  await updateAhVideoFields(video.id, {
    bgmStatus: nextStatus,
    bgmTracks: tracks as unknown as Record<string, unknown>[],
    bgmError: error,
  });
}

export async function runBgmForPendingVideos(): Promise<boolean> {
  const videos = await listAhVideos(undefined, 30);
  const candidate = videos.find((video) => {
    const status = getBgmStatus(video);
    return (
      (status === "not_started" && canStartBgm(video)) ||
      ((status === "submitting" || status === "generating") && canPollBgm(video))
    );
  });

  if (!candidate) return false;

  const status = getBgmStatus(candidate);
  if (status === "not_started") {
    await startBgmForVideo(candidate);
  } else {
    await pollBgmForVideo(candidate);
  }

  return true;
}
