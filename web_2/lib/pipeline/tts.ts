import OpenAI from "openai";
import { getAhConfigValue } from "@/lib/db/repo/channel-config";
import { claimVideoForTtsSubmit, listInPipelineAhVideos, updateAhVideoFields, updateAhVideoStatus } from "@/lib/db/repo/videos";
import { transcribeAudio } from "./whisper";
import { enqueueAhStage } from "./createJob";

// Marker stored in audio_url when OpenAI TTS was used (audio not stored externally)
const OPENAI_TTS_DONE = "openai:tts_done";

const TARGET_IMAGES = 110; // target image count per video
const MIN_SECS = 5;        // minimum bucket duration
const MAX_SECS = 20;       // hard-cut if no sentence boundary found

/**
 * Merges Whisper segments into scene buckets before passing to S3.
 * Auto-calibrates bucket size from video duration (TARGET_IMAGES target),
 * and only flushes at sentence boundaries for coherent image prompts.
 */
function smartBucketTranscript(transcript: string): string {
  const segs = transcript.split("\n").filter(l => l.trim()).map(l => {
    const m = l.match(/^\[(\d{2}):(\d{2})\]\s*(.*)/);
    if (!m) return null;
    return { t: parseInt(m[1]) * 60 + parseInt(m[2]), text: m[3].trim() };
  }).filter(Boolean) as { t: number; text: string }[];

  if (segs.length === 0) return transcript;

  const totalSecs = segs[segs.length - 1].t;
  const idealSecs = Math.max(MIN_SECS, Math.min(MAX_SECS, totalSecs / TARGET_IMAGES));
  const isSentenceEnd = (text: string) => /[.!?…。]$/.test(text);

  const buckets: { t: number; texts: string[] }[] = [];

  for (const seg of segs) {
    const last = buckets[buckets.length - 1];
    if (!last) {
      buckets.push({ t: seg.t, texts: [seg.text] });
      continue;
    }
    const elapsed = seg.t - last.t;
    const shouldFlush =
      (elapsed >= idealSecs && isSentenceEnd(last.texts[last.texts.length - 1]))
      || elapsed >= MAX_SECS;
    if (shouldFlush) {
      buckets.push({ t: seg.t, texts: [seg.text] });
    } else {
      last.texts.push(seg.text);
    }
  }

  console.log(`[smartBucket] ${segs.length} segs → ${buckets.length} scenes (ideal ${idealSecs.toFixed(1)}s, video ${Math.round(totalSecs)}s)`);

  return buckets.map(b => {
    const mm = String(Math.floor(b.t / 60)).padStart(2, "0");
    const ss = String(b.t % 60).padStart(2, "0");
    return `[${mm}:${ss}] ${b.texts.join(" ")}`;
  }).join("\n");
}

// ── Provider 1: AI33.PRO ────────────────────────────────────────────────────
const TTS_BASE_URL = "https://api.ai33.pro";
const TTS_TASK_PREFIX = "tts_task:";

// ── Provider 2: Genmax ──────────────────────────────────────────────────────
const GENMAX_BASE_URL = "https://api.genmax.io";
const TTS_TASK_GX_PREFIX = "tts_task_gx:";

// Atomic lock written to audio_url while submitting to prevent duplicate submissions
const TTS_SUBMITTING = "tts_submitting";
// If stuck in tts_submitting for > 2 min (crashed mid-submit), reset and retry
const MAX_SUBMITTING_MS = 2 * 60 * 1000;

export async function getAhVoiceId(videoVoiceId: string | null): Promise<string> {
  if (videoVoiceId) return videoVoiceId;
  const configured = await getAhConfigValue("voice_id");
  if (configured) return configured;
  throw new Error("[tts] No voice_id configured. Set it in Settings or on the video.");
}

export async function getAhBackupVoiceId(): Promise<string | null> {
  const configured = await getAhConfigValue("voice_id_2");
  return configured || null;
}

// Returns voice_id_gx if set, else falls back to voice_id
async function getAhVoiceIdGx(videoVoiceId: string | null): Promise<string> {
  const gx = await getAhConfigValue("voice_id_gx");
  if (gx) return gx;
  return getAhVoiceId(videoVoiceId);
}

/**
 * Submits a TTS job to AI33.PRO ElevenLabs v1.
 * Auth: `xi-api-key` header per the current API docs.
 */
export async function submitTTS(text: string, voiceId: string): Promise<string> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) throw new Error("[tts] VIVOO_API_KEY env var is not set");

  const res = await fetch(
    `${TTS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    }
  );

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
    console.log(`[tts] cancelTTSTask ${taskId} → HTTP ${res.status}`);
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
const MAX_TTS_AGE_MS = 15 * 60 * 1000;

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
 * Submits a TTS task for the given voice and saves a sentinel "tts_task:{taskId}"
 * into audioUrl so the next cron cycle can poll it.
 */
async function submitAndSaveTTSTask(videoId: number, script: string, voiceId: string): Promise<void> {
  const taskId = await submitTTS(script, voiceId);
  await updateAhVideoFields(videoId, { audioUrl: `${TTS_TASK_PREFIX}${taskId}` });
  console.log(`[tts] Video #${videoId} TTS submitted → task ${taskId} (voice: ${voiceId})`);
}

/** Split text into chunks of at most maxChars, breaking at paragraph/sentence boundaries. */
function splitIntoChunks(text: string, maxChars = 4000): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";
  for (const para of paragraphs) {
    if (current && (current + "\n\n" + para).length > maxChars) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  // If any individual paragraph exceeds maxChars, split further by sentence
  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxChars) return [chunk];
    const sentences = chunk.split(/(?<=[.!?])\s+/);
    const sub: string[] = [];
    let cur = "";
    for (const s of sentences) {
      if (cur && (cur + " " + s).length > maxChars) { sub.push(cur.trim()); cur = s; }
      else { cur = cur ? cur + " " + s : s; }
    }
    if (cur.trim()) sub.push(cur.trim());
    return sub;
  });
}

/**
 * Fallback TTS using OpenAI. Splits long scripts into ≤4000-char chunks,
 * concatenates the MP3 buffers, then pipes the full audio to Whisper.
 * No external audio storage needed — sets audio_url = OPENAI_TTS_DONE marker.
 */
async function runOpenAITTSAndWhisper(videoId: number, script: string, topic: { title?: string } | null): Promise<void> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chunks = splitIntoChunks(script, 4000);
  console.log(`[tts-openai] Video #${videoId} generating TTS (${chunks.length} chunks) via OpenAI...`);

  const buffers: ArrayBuffer[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const resp = await openai.audio.speech.create({
      model: "tts-1",
      voice: "onyx",
      input: chunks[i],
      response_format: "mp3",
    });
    buffers.push(await resp.arrayBuffer());
    console.log(`[tts-openai] Video #${videoId} chunk ${i + 1}/${chunks.length} done`);
  }

  // Concatenate MP3 frames (valid for Whisper ingestion)
  const totalLen = buffers.reduce((s, b) => s + b.byteLength, 0);
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const buf of buffers) { merged.set(new Uint8Array(buf), offset); offset += buf.byteLength; }

  console.log(`[tts-openai] Video #${videoId} audio ready (${Math.round(totalLen / 1024)}KB), transcribing...`);
  const file = new File([merged], "audio.mp3", { type: "audio/mpeg" });
  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  const segments = (transcription as unknown as { segments?: Array<{ start: number; text: string }> }).segments ?? [];
  const whisperTranscript = segments.length > 0
    ? segments.map((seg) => `[${formatTime(seg.start)}] ${seg.text.trim()}`).join("\n")
    : transcription.text ?? "";

  await updateAhVideoFields(videoId, { audioUrl: OPENAI_TTS_DONE, whisperTranscript });
  await updateAhVideoStatus(videoId, "s3_pending");
  await enqueueAhStage({
    promptKey: "S3", stage: "S3",
    vars: { TIMESTAMPED_SCRIPT: smartBucketTranscript(whisperTranscript), TOPIC_TITLE: topic?.title ?? "" },
    videoId,
  });
  console.log(`[tts-openai] Video #${videoId} → transcript saved (${whisperTranscript.length} chars), S3 enqueued`);
}

/**
 * Fire-and-poll TTS runner — safe for short-lived serverless functions.
 *
 * Provider priority: AI33.PRO → Genmax → OpenAI (blocking fallback)
 *
 * Each cron cycle does exactly ONE async operation:
 *   - no audioUrl          → submit AI33 → on error, submit Genmax → on error, run OpenAI
 *   - tts_task:{id}        → poll AI33 once: running→wait, done→Whisper, error/stuck→Genmax
 *   - tts_task_gx:{id}     → poll Genmax once: running→wait, done→Whisper, error/stuck→OpenAI
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

    // ── Phase 1: submit TTS (atomic claim prevents duplicate submissions) ──
    if (!video.audioUrl) {
      const claimed = await claimVideoForTtsSubmit(videoId);
      if (!claimed) {
        console.log(`[tts] Video #${videoId} already claimed by another cycle — skipping`);
        return false;
      }
      const voiceId = await getAhVoiceId(video.voiceId);
      try {
        await submitAndSaveTTSTask(videoId, video.script, voiceId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[tts] AI33.PRO submit failed — trying Genmax: ${msg}`);
        await updateAhVideoFields(videoId, { audioUrl: null }); // release claim lock
        try {
          const gxVoiceId = await getAhVoiceIdGx(video.voiceId);
          await submitAndSaveGenmax(videoId, video.script, gxVoiceId);
        } catch (gxErr) {
          const gxMsg = gxErr instanceof Error ? gxErr.message : String(gxErr);
          console.warn(`[tts-gx] Genmax submit failed — falling back to OpenAI: ${gxMsg}`);
          await runOpenAITTSAndWhisper(videoId, video.script, topic);
        }
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
      const taskId = video.audioUrl.slice(TTS_TASK_PREFIX.length);
      const result = await checkTTSTask(taskId);

      if (result.status === "running") {
        const ageMs = Date.now() - new Date(video.updatedAt).getTime();
        if (ageMs > MAX_TTS_AGE_MS) {
          console.warn(`[tts] Video #${videoId} AI33 task ${taskId} stuck for ${Math.round(ageMs / 60000)}min — failing over to Genmax`);
          await cancelTTSTask(taskId);
          const gxVoiceId = await getAhVoiceIdGx(video.voiceId);
          await submitAndSaveGenmax(videoId, video.script!, gxVoiceId);
          return true;
        }
        console.log(`[tts] Video #${videoId} AI33 task ${taskId} still running — next cycle`);
        return false;
      }

      if (result.status === "error") {
        console.warn(`[tts] Video #${videoId} AI33 TTS error — failing over to Genmax: ${result.message}`);
        await cancelTTSTask(taskId);
        const gxVoiceId = await getAhVoiceIdGx(video.voiceId);
        await submitAndSaveGenmax(videoId, video.script!, gxVoiceId);
        return true;
      }

      // done — save real audio URL and fall through to Whisper
      await updateAhVideoFields(videoId, { audioUrl: result.audioUrl });
      video.audioUrl = result.audioUrl;
    }

    // ── Phase 2b: poll Genmax task ──────────────────────────────────────────
    if (video.audioUrl.startsWith(TTS_TASK_GX_PREFIX)) {
      const taskId = video.audioUrl.slice(TTS_TASK_GX_PREFIX.length);
      const result = await checkGenmax(taskId);

      if (result.status === "running") {
        const ageMs = Date.now() - new Date(video.updatedAt).getTime();
        if (ageMs > MAX_TTS_AGE_MS) {
          console.warn(`[tts-gx] Video #${videoId} Genmax task ${taskId} stuck for ${Math.round(ageMs / 60000)}min — falling back to OpenAI`);
          await cancelGenmax(taskId);
          await runOpenAITTSAndWhisper(videoId, video.script!, topic);
          return true;
        }
        console.log(`[tts-gx] Video #${videoId} Genmax task ${taskId} still running — next cycle`);
        return false;
      }

      if (result.status === "error") {
        console.warn(`[tts-gx] Video #${videoId} Genmax error — falling back to OpenAI: ${result.message}`);
        await cancelGenmax(taskId);
        await runOpenAITTSAndWhisper(videoId, video.script!, topic);
        return true;
      }

      // done — save real audio URL and fall through to Whisper
      await updateAhVideoFields(videoId, { audioUrl: result.audioUrl });
      video.audioUrl = result.audioUrl;
    }

    // ── Phase 3: Whisper transcription ─────────────────────────────────────
    if (!video.whisperTranscript) {
      const whisperTranscript = await transcribeAudio(video.audioUrl!);
      await updateAhVideoFields(videoId, { whisperTranscript });

      await updateAhVideoStatus(videoId, "s3_pending");
      const topic = video.chosenTopic as { title?: string } | null;
      await enqueueAhStage({
        promptKey: "S3",
        stage: "S3",
        vars: {
          TIMESTAMPED_SCRIPT: smartBucketTranscript(whisperTranscript),
          TOPIC_TITLE: topic?.title ?? "",
        },
        videoId,
      });
      console.log(`[tts] Video #${videoId} → transcript saved, S3 enqueued`);
    }

    return true;
  } catch (err) {
    console.error(`[tts] Video #${videoId} failed → needs_attention:`, err);
    await updateAhVideoStatus(videoId, "needs_attention");
    return false;
  }
}
