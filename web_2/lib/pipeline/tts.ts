import { getAhConfigValue } from "@/lib/db/repo/channel-config";
import { hasOpenAhJobForVideoStage } from "@/lib/db/repo/jobs";
import { claimVideoForTtsSubmit, listInPipelineAhVideos, updateAhVideoFields, updateAhVideoStatus } from "@/lib/db/repo/videos";
import { AH_CONFIG_KEYS } from "@/lib/db/schema";
import { transcribeAudio } from "./whisper";
import { enqueueAhStage } from "./createJob";

// MIN=4: cuts image count ~47% with zero flash (<=2s) scenes and the fewest
// mid-sentence splits (MIN=5 cuts further but doubles mid-sentence splits).
const SMART_BUCKET_MIN_DURATION = 4;
// At 3, buckets sometimes land under MIN and still split a sentence; 4 clears
// that without increasing image count.
const SMART_BUCKET_MAX_SEGMENTS_PER_BUCKET = 4;
// Hard cap enforced via look-ahead flush below, never exceeded.
const SMART_BUCKET_MAX_DURATION = 12;
// Duration estimate for the trailing segment, which has no "next" timestamp.
const SMART_BUCKET_CHARS_PER_SEC = 15;
const SMART_BUCKET_SENTENCE_END = /[.!?]["')]?\s*$/;

type WhisperSeg = { t: number; text: string };
type SmartBucket = { t: number; text: string; dur: number; segs: number };

/**
 * Greedily merges short Whisper timestamp lines into scenes of roughly
 * MIN_DURATION-MAX_DURATION seconds of screen time (gap to the next segment's
 * start, which includes any pause — that's what the image is actually shown
 * for, not the spoken duration), so fast/staccato narration doesn't produce a
 * flood of near-instant image prompts. Falls back to 1:1 passthrough for
 * segments that are already long enough.
 */
export function smartBucketTranscript(transcript: string): string {
  const segs = transcript.split("\n").filter(l => l.trim()).map(l => {
    const m = l.match(/^\[(\d{2}):(\d{2})\]\s*(.*)/);
    if (!m) return null;
    return { t: parseInt(m[1]) * 60 + parseInt(m[2]), text: m[3].trim() };
  }).filter(Boolean) as WhisperSeg[];

  if (segs.length === 0) return transcript;

  const buckets: SmartBucket[] = [];
  let cur: SmartBucket | null = null;

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const dur = i + 1 < segs.length
      ? segs[i + 1].t - seg.t
      : Math.max(2, Math.round(seg.text.length / SMART_BUCKET_CHARS_PER_SEC));

    // Look-ahead flush: stop BEFORE adding a segment that would push the
    // current bucket past MAX_DURATION, so the cap is never overshot.
    if (cur && cur.dur + dur > SMART_BUCKET_MAX_DURATION) {
      buckets.push(cur);
      cur = null;
    }

    if (!cur) {
      cur = { t: seg.t, text: seg.text, dur, segs: 1 };
      if (dur > SMART_BUCKET_MAX_DURATION) {
        console.warn(`[smartBucket] single segment at ${seg.t}s spans ${dur}s (> ${SMART_BUCKET_MAX_DURATION}s max) — kept as its own scene, not split`);
      }
    } else {
      cur.text += " " + seg.text;
      cur.dur += dur;
      cur.segs += 1;
    }

    const hitMin = cur.dur >= SMART_BUCKET_MIN_DURATION;
    const endsSentence = SMART_BUCKET_SENTENCE_END.test(seg.text);
    const hardCap = cur.segs >= SMART_BUCKET_MAX_SEGMENTS_PER_BUCKET || cur.dur >= SMART_BUCKET_MAX_DURATION;

    if (hardCap || (hitMin && endsSentence)) {
      buckets.push(cur);
      cur = null;
    }
  }

  if (cur) {
    if (cur.dur < SMART_BUCKET_MIN_DURATION && buckets.length > 0) {
      const last = buckets[buckets.length - 1];
      last.text += " " + cur.text;
      last.dur += cur.dur;
      last.segs += cur.segs;
    } else {
      buckets.push(cur);
    }
  }

  console.log(`[smartBucket] merged ${segs.length} Whisper timestamp lines -> ${buckets.length} S3 scenes`);

  return buckets.map(bucket => {
    const mm = String(Math.floor(bucket.t / 60)).padStart(2, "0");
    const ss = String(bucket.t % 60).padStart(2, "0");
    return `[${mm}:${ss}] ${bucket.text}`;
  }).join("\n");
}

// ── Provider 1: AI33.PRO ────────────────────────────────────────────────────
const TTS_BASE_URL = "https://api.ai33.pro";
const TTS_TASK_PREFIX = "tts_task:";
const TTS_TASK_VOICE_MARKER = ":voice:";

function normalizeProviderVoiceId(voiceId: string): string {
  const normalized = voiceId
    .replace(/^elevenlabs_/, "")
    .replace(/^minimax_/, "")
    .replace(/^clone_/, "");
  if (normalized === voiceId && /^[a-z]+_/.test(voiceId)) {
    console.warn(`[tts] normalizeProviderVoiceId: unrecognized prefix in voice ID "${voiceId}" — passing through unchanged`);
  }
  return normalized;
}

// ── Provider 2: Genmax ──────────────────────────────────────────────────────
const GENMAX_BASE_URL = "https://api.genmax.io";
const TTS_TASK_GX_PREFIX = "tts_task_gx:";

// Atomic lock written to audio_url while submitting to prevent duplicate submissions
const TTS_SUBMITTING = "tts_submitting";
// If stuck in tts_submitting for > 2 min (crashed mid-submit), reset and retry
const MAX_SUBMITTING_MS = 2 * 60 * 1000;
const TTS_PROVIDER_MODE_AUTO = "auto";
const TTS_PROVIDER_MODE_AI33_BACKUP = "ai33_backup";
const TTS_PROVIDER_MODE_GENMAX = "genmax";
const TTS_PROVIDER_MODES = new Set<string>([
  TTS_PROVIDER_MODE_AUTO,
  TTS_PROVIDER_MODE_AI33_BACKUP,
  TTS_PROVIDER_MODE_GENMAX,
]);

type TtsProviderMode =
  | typeof TTS_PROVIDER_MODE_AUTO
  | typeof TTS_PROVIDER_MODE_AI33_BACKUP
  | typeof TTS_PROVIDER_MODE_GENMAX;

async function getTtsProviderMode(): Promise<TtsProviderMode> {
  const configured = await getAhConfigValue(AH_CONFIG_KEYS.ttsProviderMode);
  if (!configured) return TTS_PROVIDER_MODE_AUTO;
  if (TTS_PROVIDER_MODES.has(configured)) return configured as TtsProviderMode;
  console.warn(`[tts] Invalid tts_provider_mode "${configured}" — using auto`);
  return TTS_PROVIDER_MODE_AUTO;
}

function describeTtsProviderMode(mode: TtsProviderMode): string {
  if (mode === TTS_PROVIDER_MODE_AI33_BACKUP) return "AI33 backup MiniMax";
  if (mode === TTS_PROVIDER_MODE_GENMAX) return "Genmax";
  return "Auto";
}

export async function getAhVoiceId(videoVoiceId: string | null): Promise<string> {
  if (videoVoiceId) return videoVoiceId;
  const configured = await getAhConfigValue(AH_CONFIG_KEYS.voiceId);
  if (configured) return configured;
  throw new Error("[tts] No voice_id configured. Set it in Settings or on the video.");
}

export async function describePendingTtsWait(): Promise<string | null> {
  const videos = await listInPipelineAhVideos();
  const video = videos.find((v) => v.status === "tts_pending") ?? null;
  if (!video?.audioUrl) return null;

  const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(video.updatedAt).getTime()) / 60000));
  const mode = await getTtsProviderMode();
  const modeText = describeTtsProviderMode(mode);
  if (video.audioUrl === TTS_SUBMITTING) {
    return `Video #${video.id} is submitting TTS (${modeText}, ${ageMinutes}m).`;
  }
  if (video.audioUrl.startsWith(TTS_TASK_PREFIX)) {
    const { taskId } = parseTTSTaskMarker(video.audioUrl);
    return `Video #${video.id} is waiting on AI33 task ${taskId} (${modeText}, ${ageMinutes}m).`;
  }
  if (video.audioUrl.startsWith(TTS_TASK_GX_PREFIX)) {
    return `Video #${video.id} is waiting on Genmax task ${video.audioUrl.slice(TTS_TASK_GX_PREFIX.length)} (${modeText}, ${ageMinutes}m).`;
  }
  if (!video.whisperTranscript) {
    return `Video #${video.id} has audio and is waiting for Whisper.`;
  }
  return null;
}

export async function getAhBackupVoiceId(): Promise<string | null> {
  const configured = await getAhConfigValue(AH_CONFIG_KEYS.voiceId2);
  return configured || null;
}

// Returns voice_id_gx if set, else falls back to voice_id
async function getAhVoiceIdGx(videoVoiceId: string | null): Promise<string> {
  const gx = await getAhConfigValue(AH_CONFIG_KEYS.voiceIdGx);
  if (gx) return gx;
  return getAhVoiceId(videoVoiceId);
}

/**
 * Submits a TTS job to AI33.PRO.
 * Auth: `xi-api-key` header per the current API docs.
 * v3 uses one FormData endpoint and expects provider-prefixed voice IDs.
 */
export async function submitTTS(text: string, voiceId: string): Promise<string> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) throw new Error("[tts] VIVOO_API_KEY env var is not set");

  const form = new FormData();
  form.set("text", text);
  form.set("voice_id", voiceId);
  form.set("speed", "1");
  form.set("with_transcript", "false");

  const res = await fetch(`${TTS_BASE_URL}/v3/text-to-speech`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[tts] submitTTS HTTP ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { task_id?: string; success?: boolean };
  if (!json.task_id) {
    throw new Error(`[tts] submitTTS: no task_id in response: ${JSON.stringify(json)}`);
  }
  return json.task_id;
}

/**
 * Cancels a TTS task to release frozen credits.
 * Fire-and-forget safe — logs but never throws.
 */
export async function cancelTTSTask(taskId: string): Promise<void> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) return;
  try {
    const res = await fetch(`${TTS_BASE_URL}/v1/task/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({ task_ids: [taskId] }),
    });
    const json = (await res.json().catch(() => null)) as { refund_credits?: number; refunded_credits?: number } | null;
    console.log(`[tts] cancelTTSTask ${taskId} → HTTP ${res.status}, refunded ${json?.refund_credits ?? json?.refunded_credits ?? 0} credits`);
  } catch (err) {
    console.warn(`[tts] cancelTTSTask ${taskId} failed (credits may stay frozen):`, err);
  }
}

// ── Genmax submit/poll/cancel ───────────────────────────────────────────────

/** MiniMax voice IDs are purely numeric (e.g. "226905123659939"). ElevenLabs IDs are alphanumeric. */
function isMinimaxVoiceId(voiceId: string): boolean {
  return /^\d+$/.test(voiceId);
}

async function submitGenmax(text: string, voiceId: string): Promise<string> {
  const apiKey = process.env.GENMAX_API_KEY;
  if (!apiKey) throw new Error("[tts-gx] GENMAX_API_KEY env var is not set");

  const minimax = isMinimaxVoiceId(voiceId);
  const body: Record<string, unknown> = {
    text,
    model_id: minimax ? "speech-2.8-turbo" : "eleven_multilingual_v2",
    language_code: minimax ? "English" : "en",
    ...(minimax && { provider: "minimax" }),
  };

  const res = await fetch(
    `${GENMAX_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`[tts-gx] submit HTTP ${res.status}: ${txt}`);
  }

  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error(`[tts-gx] no id in response: ${JSON.stringify(json)}`);
  return json.id;
}

async function checkGenmax(taskId: string): Promise<TtsTaskResult> {
  const apiKey = process.env.GENMAX_API_KEY;
  if (!apiKey) return { status: "error", message: "[tts-gx] GENMAX_API_KEY not set" };

  let res: Response;
  try {
    res = await fetch(`${GENMAX_BASE_URL}/v1/history/${taskId}`, {
      headers: { "xi-api-key": apiKey },
    });
  } catch (err) {
    return { status: "error", message: `[tts-gx] network error: ${String(err)}` };
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { status: "error", message: `[tts-gx] HTTP ${res.status}: ${txt}` };
  }

  const json = (await res.json()) as {
    status?: string;
    result?: { audio_url?: string };
    error?: string;
  };

  if (json.status === "completed") {
    const audioUrl = json.result?.audio_url;
    if (!audioUrl) return { status: "error", message: `[tts-gx] completed but no audio_url` };
    return { status: "done", audioUrl };
  }
  if (json.status === "failed") {
    return { status: "error", message: `[tts-gx] task failed: ${json.error ?? "unknown"}` };
  }
  return { status: "running" };
}

async function cancelGenmax(taskId: string): Promise<void> {
  const apiKey = process.env.GENMAX_API_KEY;
  if (!apiKey) return;
  try {
    await fetch(`${GENMAX_BASE_URL}/v1/history/${taskId}`, {
      method: "DELETE",
      headers: { "xi-api-key": apiKey },
    });
    console.log(`[tts-gx] cancelGenmax ${taskId} done`);
  } catch (err) {
    console.warn(`[tts-gx] cancelGenmax ${taskId} failed:`, err);
  }
}

async function submitAndSaveGenmax(videoId: number, script: string, voiceId: string): Promise<void> {
  const taskId = await submitGenmax(script, voiceId);
  await updateAhVideoFields(videoId, { audioUrl: `${TTS_TASK_GX_PREFIX}${taskId}` });
  console.log(`[tts-gx] Video #${videoId} submitted → Genmax task ${taskId} (voice: ${voiceId})`);
}

// ── AI33.PRO uses "doing" for in-progress tasks ────────────────────────────
const TTS_RUNNING_STATUSES = new Set(["pending", "processing", "doing", "queued"]);
// Failover after this many ms — covers ~3 cron cycles at 5-min interval
const MAX_TTS_AGE_MS = 10 * 60 * 1000;

type TtsTaskResult =
  | { status: "done"; audioUrl: string }
  | { status: "running" }
  | { status: "error"; message: string };

/**
 * Checks a TTS task status ONCE (no polling loop — safe for short-lived functions).
 * Returns done/running/error so the caller decides what to do next cycle.
 */
async function checkTTSTask(taskId: string): Promise<TtsTaskResult> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) return { status: "error", message: "[tts] VIVOO_API_KEY not set" };

  let res: Response;
  try {
    res = await fetch(`${TTS_BASE_URL}/v1/task/${taskId}`, {
      headers: { "xi-api-key": apiKey },
    });
  } catch (err) {
    return { status: "error", message: `[tts] network error: ${String(err)}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { status: "error", message: `[tts] HTTP ${res.status}: ${body}` };
  }

  // Actual response: { id, status, metadata: { audio_url, ... }, progress, type }
  const json = (await res.json()) as {
    status?: string;
    metadata?: { audio_url?: string };
    error_message?: string;
  };

  if (json.status === "done") {
    const audioUrl = json.metadata?.audio_url;
    if (!audioUrl) return { status: "error", message: `[tts] Task ${taskId} done but no audio_url` };
    return { status: "done", audioUrl };
  }
  if (json.status && TTS_RUNNING_STATUSES.has(json.status)) {
    return { status: "running" };
  }
  return { status: "error", message: `[tts] Task failed with status: ${json.status} — ${json.error_message ?? ""}` };
}

/**
 * Submits a TTS task and saves a sentinel into audioUrl so the next cron cycle can poll it.
 */
async function submitAndSaveTTSTask(videoId: number, script: string, voiceId: string): Promise<void> {
  const taskId = await submitTTS(script, voiceId);
  await updateAhVideoFields(videoId, {
    audioUrl: `${TTS_TASK_PREFIX}${taskId}${TTS_TASK_VOICE_MARKER}${encodeURIComponent(voiceId)}`,
  });
  console.log(`[tts] Video #${videoId} TTS submitted → task ${taskId} (voice: ${voiceId})`);
}

function parseTTSTaskMarker(audioUrl: string): { taskId: string; voiceId?: string } {
  const value = audioUrl.slice(TTS_TASK_PREFIX.length);
  const voiceMarkerIndex = value.lastIndexOf(TTS_TASK_VOICE_MARKER);
  if (voiceMarkerIndex === -1) return { taskId: value };
  return {
    taskId: value.slice(0, voiceMarkerIndex),
    voiceId: decodeURIComponent(value.slice(voiceMarkerIndex + TTS_TASK_VOICE_MARKER.length)),
  };
}

async function trySubmitBackupTTSTask(
  videoId: number,
  script: string,
  attemptedVoiceId: string,
): Promise<boolean> {
  const backupVoiceId = await getAhBackupVoiceId();
  if (!backupVoiceId || normalizeProviderVoiceId(backupVoiceId) === normalizeProviderVoiceId(attemptedVoiceId)) {
    return false;
  }
  await submitAndSaveTTSTask(videoId, script, backupVoiceId);
  return true;
}

async function submitBackupTTSTask(videoId: number, script: string): Promise<void> {
  const backupVoiceId = await getAhBackupVoiceId();
  if (!backupVoiceId) {
    throw new Error("No backup MiniMax voice configured.");
  }
  await submitAndSaveTTSTask(videoId, script, backupVoiceId);
}

function isSameVoiceId(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return normalizeProviderVoiceId(a) === normalizeProviderVoiceId(b);
}

async function submitTtsForMode(
  videoId: number,
  script: string,
  videoVoiceId: string | null,
  mode: TtsProviderMode,
): Promise<void> {
  if (mode === TTS_PROVIDER_MODE_AI33_BACKUP) {
    await submitBackupTTSTask(videoId, script);
    return;
  }

  if (mode === TTS_PROVIDER_MODE_GENMAX) {
    const gxVoiceId = await getAhVoiceIdGx(videoVoiceId);
    await submitAndSaveGenmax(videoId, script, gxVoiceId);
    return;
  }

  const voiceId = await getAhVoiceId(videoVoiceId);
  try {
    await submitAndSaveTTSTask(videoId, script, voiceId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[tts] AI33.PRO primary submit failed — trying backup voice: ${msg}`);
    await updateAhVideoFields(videoId, { audioUrl: null });
    try {
      const submittedBackup = await trySubmitBackupTTSTask(videoId, script, voiceId);
      if (submittedBackup) return;
      throw new Error("No backup voice configured.");
    } catch (backupErr) {
      const backupMsg = backupErr instanceof Error ? backupErr.message : String(backupErr);
      console.warn(`[tts] AI33.PRO backup submit failed — trying Genmax: ${backupMsg}`);
      await updateAhVideoFields(videoId, { audioUrl: null });
      try {
        const gxVoiceId = await getAhVoiceIdGx(videoVoiceId);
        await submitAndSaveGenmax(videoId, script, gxVoiceId);
      } catch (gxErr) {
        const gxMsg = gxErr instanceof Error ? gxErr.message : String(gxErr);
        await updateAhVideoFields(videoId, { audioUrl: null });
        throw new Error(`All TTS providers failed. AI33 primary: ${msg}; AI33 backup: ${backupMsg}; Genmax: ${gxMsg}`);
      }
    }
  }
}

async function failoverFromAI33Task(
  videoId: number,
  script: string,
  videoVoiceId: string | null,
  attemptedVoiceId: string | undefined,
  cause: string,
  mode: TtsProviderMode,
): Promise<void> {
  await updateAhVideoFields(videoId, { audioUrl: null });

  if (mode === TTS_PROVIDER_MODE_AI33_BACKUP) {
    throw new Error(`AI33 backup TTS failed (${cause}). Switch TTS Provider Mode to Genmax if AI33 is overloaded.`);
  }

  if (mode === TTS_PROVIDER_MODE_GENMAX) {
    const gxVoiceId = await getAhVoiceIdGx(videoVoiceId);
    await submitAndSaveGenmax(videoId, script, gxVoiceId);
    return;
  }

  const currentVoiceId = attemptedVoiceId ?? await getAhVoiceId(videoVoiceId);

  try {
    const submittedBackup = await trySubmitBackupTTSTask(videoId, script, currentVoiceId);
    if (submittedBackup) return;
  } catch (backupErr) {
    const backupMsg = backupErr instanceof Error ? backupErr.message : String(backupErr);
    console.warn(`[tts] AI33.PRO backup submit failed — trying Genmax: ${backupMsg}`);
  }

  try {
    const gxVoiceId = await getAhVoiceIdGx(videoVoiceId);
    await submitAndSaveGenmax(videoId, script, gxVoiceId);
  } catch (gxErr) {
    const gxMsg = gxErr instanceof Error ? gxErr.message : String(gxErr);
    await updateAhVideoFields(videoId, { audioUrl: null });
    throw new Error(`AI33 failed (${cause}); Genmax failed: ${gxMsg}`);
  }
}

async function ensureS3JobForTranscript(
  videoId: number,
  whisperTranscript: string,
  topic: { title?: string } | null,
): Promise<void> {
  const hasOpenS3Job = await hasOpenAhJobForVideoStage(videoId, "S3");
  if (!hasOpenS3Job) {
    await enqueueAhStage({
      promptKey: "S3",
      stage: "S3",
      vars: {
        TIMESTAMPED_SCRIPT: smartBucketTranscript(whisperTranscript),
        TOPIC_TITLE: topic?.title ?? "",
      },
      videoId,
    });
  }
  await updateAhVideoStatus(videoId, "s3_pending");
}

/**
 * Fire-and-poll TTS runner — safe for short-lived serverless functions.
 *
 * Provider priority: AI33.PRO primary → AI33.PRO backup → Genmax.
 *
 * Each cron cycle does exactly ONE async operation:
 *   - no audioUrl          → submit AI33 primary → backup → Genmax
 *   - tts_task:{id}        → poll AI33 once: running→wait, done→Whisper, error/stuck→backup/Genmax
 *   - tts_task_gx:{id}     → poll Genmax once: running→wait, done→Whisper, error/stuck→needs_attention
 *   - real audio URL       → run Whisper + advance (resume after partial failure)
 */
export async function runTTSAndWhisperForPendingVideo(): Promise<boolean> {
  const videos = await listInPipelineAhVideos();
  const video = videos.find((v) => v.status === "tts_pending") ?? null;
  if (!video) return false;

  const videoId = video.id;

  try {
    if (!video.script) {
      console.error(`[tts] Video #${videoId} has no script`);
      await updateAhVideoStatus(videoId, "needs_attention");
      return false;
    }

    const topic = video.chosenTopic as { title?: string } | null;
    const providerMode = await getTtsProviderMode();

    // ── Phase 1: submit TTS (atomic claim prevents duplicate submissions) ──
    if (!video.audioUrl) {
      const claimed = await claimVideoForTtsSubmit(videoId);
      if (!claimed) {
        console.log(`[tts] Video #${videoId} already claimed by another cycle — skipping`);
        return false;
      }
      try {
        await submitTtsForMode(videoId, video.script, video.voiceId, providerMode);
      } catch (err) {
        await updateAhVideoFields(videoId, { audioUrl: null }); // release claim lock
        throw err;
      }
      return true;
    }

    // ── Phase 1b: stuck in submitting state (crashed mid-submit) ───────────
    if (video.audioUrl === TTS_SUBMITTING) {
      const ageMs = Date.now() - new Date(video.updatedAt).getTime();
      if (ageMs > MAX_SUBMITTING_MS) {
        console.warn(`[tts] Video #${videoId} stuck in tts_submitting for ${Math.round(ageMs / 1000)}s — resetting`);
        await updateAhVideoFields(videoId, { audioUrl: null });
      }
      return false;
    }

    // ── Phase 2a: poll AI33 task ────────────────────────────────────────────
    if (video.audioUrl.startsWith(TTS_TASK_PREFIX)) {
      const { taskId, voiceId: taskVoiceId } = parseTTSTaskMarker(video.audioUrl);

      if (providerMode === TTS_PROVIDER_MODE_GENMAX) {
        console.warn(`[tts] Video #${videoId} switching AI33 task ${taskId} → Genmax by tts_provider_mode`);
        await cancelTTSTask(taskId);
        await updateAhVideoFields(videoId, { audioUrl: null });
        await submitTtsForMode(videoId, video.script!, video.voiceId, providerMode);
        return true;
      }

      if (providerMode === TTS_PROVIDER_MODE_AI33_BACKUP) {
        const backupVoiceId = await getAhBackupVoiceId();
        if (!isSameVoiceId(taskVoiceId, backupVoiceId)) {
          console.warn(`[tts] Video #${videoId} switching AI33 task ${taskId} → backup voice by tts_provider_mode`);
          await cancelTTSTask(taskId);
          await updateAhVideoFields(videoId, { audioUrl: null });
          await submitTtsForMode(videoId, video.script!, video.voiceId, providerMode);
          return true;
        }
      }

      const result = await checkTTSTask(taskId);

      if (result.status === "running") {
        const ageMs = Date.now() - new Date(video.updatedAt).getTime();
        if (ageMs > MAX_TTS_AGE_MS) {
          console.warn(`[tts] Video #${videoId} AI33 task ${taskId} stuck for ${Math.round(ageMs / 60000)}min — failing over`);
          await cancelTTSTask(taskId);
          await failoverFromAI33Task(
            videoId,
            video.script!,
            video.voiceId,
            taskVoiceId,
            `task ${taskId} stuck for ${Math.round(ageMs / 60000)}min`,
            providerMode,
          );
          return true;
        }
        console.log(`[tts] Video #${videoId} AI33 task ${taskId} still running — next cycle`);
        return false;
      }

      if (result.status === "error") {
        console.warn(`[tts] Video #${videoId} AI33 TTS error — failing over: ${result.message}`);
        await cancelTTSTask(taskId);
        await failoverFromAI33Task(videoId, video.script!, video.voiceId, taskVoiceId, result.message, providerMode);
        return true;
      }

      // done — save real audio URL and fall through to Whisper
      await updateAhVideoFields(videoId, { audioUrl: result.audioUrl });
      video.audioUrl = result.audioUrl;
    }

    // ── Phase 2b: poll Genmax task ──────────────────────────────────────────
    if (video.audioUrl.startsWith(TTS_TASK_GX_PREFIX)) {
      const taskId = video.audioUrl.slice(TTS_TASK_GX_PREFIX.length);

      if (providerMode === TTS_PROVIDER_MODE_AI33_BACKUP) {
        console.warn(`[tts-gx] Video #${videoId} switching Genmax task ${taskId} → AI33 backup by tts_provider_mode`);
        await cancelGenmax(taskId);
        await updateAhVideoFields(videoId, { audioUrl: null });
        await submitTtsForMode(videoId, video.script!, video.voiceId, providerMode);
        return true;
      }

      const result = await checkGenmax(taskId);

      if (result.status === "running") {
        const ageMs = Date.now() - new Date(video.updatedAt).getTime();
        if (ageMs > MAX_TTS_AGE_MS) {
          console.warn(`[tts-gx] Video #${videoId} Genmax task ${taskId} stuck for ${Math.round(ageMs / 60000)}min`);
          await cancelGenmax(taskId);
          await updateAhVideoFields(videoId, { audioUrl: null });
          throw new Error(`Genmax task ${taskId} stuck for ${Math.round(ageMs / 60000)}min`);
        }
        console.log(`[tts-gx] Video #${videoId} Genmax task ${taskId} still running — next cycle`);
        return false;
      }

      if (result.status === "error") {
        console.warn(`[tts-gx] Video #${videoId} Genmax error: ${result.message}`);
        await cancelGenmax(taskId);
        await updateAhVideoFields(videoId, { audioUrl: null });
        throw new Error(`Genmax failed: ${result.message}`);
      }

      // done — save real audio URL and fall through to Whisper
      await updateAhVideoFields(videoId, { audioUrl: result.audioUrl });
      video.audioUrl = result.audioUrl;
    }

    // ── Phase 3: Whisper transcription ─────────────────────────────────────
    if (!video.whisperTranscript) {
      const whisperTranscript = await transcribeAudio(video.audioUrl!);
      await updateAhVideoFields(videoId, { whisperTranscript });
      await ensureS3JobForTranscript(videoId, whisperTranscript, topic);
      console.log(`[tts] Video #${videoId} → transcript saved, S3 enqueued`);
    } else {
      await ensureS3JobForTranscript(videoId, video.whisperTranscript, topic);
    }

    return true;
  } catch (err) {
    console.error(`[tts] Video #${videoId} failed → needs_attention:`, err);
    await updateAhVideoStatus(videoId, "needs_attention");
    return false;
  }
}
