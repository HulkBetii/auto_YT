import OpenAI from "openai";
import { getAhConfigValue } from "@/lib/db/repo/channel-config";
import { claimVideoForTtsSubmit, listInPipelineAhVideos, updateAhVideoFields, updateAhVideoStatus } from "@/lib/db/repo/videos";
import { transcribeAudio } from "./whisper";
import { enqueueAhStage } from "./createJob";

// Marker stored in audio_url when OpenAI TTS was used (audio not stored externally)
const OPENAI_TTS_DONE = "openai:tts_done";

const TTS_BASE_URL = "https://api.ai33.pro";
const TTS_TASK_PREFIX = "tts_task:";
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

/**
 * Submits a TTS job to AI33.PRO Vivoo V3.
 * Auth: `Authorization: <key>` — NO "Bearer" prefix per the API docs.
 */
export async function submitTTS(text: string, voiceId: string): Promise<string> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) throw new Error("[tts] VIVOO_API_KEY env var is not set");

  const speed = voiceId.startsWith("elevenlabs_") ? "0.96" : "1";

  const form = new FormData();
  form.append("text", text);
  form.append("voice_id", voiceId);
  form.append("speed", speed);

  const res = await fetch(`${TTS_BASE_URL}/v3/text-to-speech`, {
    method: "POST",
    headers: { Authorization: apiKey },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[tts] submitTTS HTTP ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { task_id?: string; error?: string };
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
    const res = await fetch(`${TTS_BASE_URL}/v3/task/${taskId}`, {
      method: "DELETE",
      headers: { Authorization: apiKey },
    });
    console.log(`[tts] cancelTTSTask ${taskId} → HTTP ${res.status}`);
  } catch (err) {
    console.warn(`[tts] cancelTTSTask ${taskId} failed (credits may stay frozen):`, err);
  }
}

// AI33.PRO uses "doing" for in-progress tasks
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
    res = await fetch(`${TTS_BASE_URL}/v3/task/${taskId}`, {
      headers: { Authorization: apiKey },
    });
  } catch (err) {
    return { status: "error", message: `[tts] network error: ${String(err)}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { status: "error", message: `[tts] HTTP ${res.status}: ${body}` };
  }

  const json = (await res.json()) as {
    data?: { status?: string; metadata?: { audio_url?: string }; error?: string };
  };
  const data = json.data;
  if (!data) return { status: "error", message: `[tts] Unexpected response: ${JSON.stringify(json)}` };

  if (data.status === "done") {
    const audioUrl = data.metadata?.audio_url;
    if (!audioUrl) return { status: "error", message: `[tts] Task ${taskId} done but no audio_url` };
    return { status: "done", audioUrl };
  }
  if (data.status && TTS_RUNNING_STATUSES.has(data.status)) {
    return { status: "running" };
  }
  return { status: "error", message: `[tts] Task failed with status: ${data.status} — ${data.error ?? ""}` };
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
    vars: { TIMESTAMPED_SCRIPT: whisperTranscript, TOPIC_TITLE: topic?.title ?? "" },
    videoId,
  });
  console.log(`[tts-openai] Video #${videoId} → transcript saved (${whisperTranscript.length} chars), S3 enqueued`);
}

/**
 * Fire-and-poll TTS runner — safe for short-lived serverless functions.
 *
 * Each cron cycle does exactly ONE async operation:
 *   - If no audioUrl          → submit TTS, save "tts_task:{id}", return (fast)
 *   - If audioUrl="tts_task:" → check task once:
 *       • running → return, wait for next cycle
 *       • done    → save real audioUrl, run Whisper, advance to S3
 *       • error   → cancel task (releases frozen credits), failover to backup voice
 *   - If audioUrl is real URL → run Whisper + advance (resume after partial failure)
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

    // ── Phase 1: submit TTS (atomic claim prevents duplicate submissions) ──
    if (!video.audioUrl) {
      const claimed = await claimVideoForTtsSubmit(videoId);
      if (!claimed) {
        console.log(`[tts] Video #${videoId} already claimed by another cycle — skipping`);
        return false;
      }
      const topic = video.chosenTopic as { title?: string } | null;
      try {
        const voiceId = await getAhVoiceId(video.voiceId);
        await submitAndSaveTTSTask(videoId, video.script, voiceId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isAuthErr = msg.includes("401") || msg.includes("Unauthorized") || msg.includes("credits");
        if (isAuthErr) {
          console.warn(`[tts] AI33.PRO auth error — falling back to OpenAI TTS: ${msg}`);
          await updateAhVideoFields(videoId, { audioUrl: null }); // release claim lock
          await runOpenAITTSAndWhisper(videoId, video.script, topic);
        } else {
          throw err;
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

    // ── Phase 2: poll pending task (one check per cycle) ───────────────────
    if (video.audioUrl.startsWith(TTS_TASK_PREFIX)) {
      const taskId = video.audioUrl.slice(TTS_TASK_PREFIX.length);
      const result = await checkTTSTask(taskId);

      if (result.status === "running") {
        // Failover if task has been stuck longer than MAX_TTS_AGE_MS
        const ageMs = Date.now() - new Date(video.updatedAt).getTime();
        if (ageMs > MAX_TTS_AGE_MS) {
          console.warn(`[tts] Video #${videoId} task ${taskId} stuck for ${Math.round(ageMs / 60000)}min — failing over`);
          await cancelTTSTask(taskId); // best-effort, may return 404
          const backupVoiceId = await getAhBackupVoiceId();
          if (backupVoiceId) {
            console.log(`[tts] Failing over to backup voice (timeout): ${backupVoiceId}`);
            await submitAndSaveTTSTask(videoId, video.script, backupVoiceId);
            return true;
          }
          throw new Error(`[tts] Task ${taskId} stuck for ${Math.round(ageMs / 60000)}min and no backup voice configured`);
        }
        console.log(`[tts] Video #${videoId} task ${taskId} still running — next cycle`);
        return false;
      }

      if (result.status === "error") {
        console.warn(`[tts] Video #${videoId} primary TTS error: ${result.message}`);
        await cancelTTSTask(taskId); // best-effort

        const backupVoiceId = await getAhBackupVoiceId();
        if (backupVoiceId) {
          console.log(`[tts] Failing over to backup voice (error): ${backupVoiceId}`);
          await submitAndSaveTTSTask(videoId, video.script, backupVoiceId);
          return true;
        }
        throw new Error(result.message);
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
          TIMESTAMPED_SCRIPT: whisperTranscript,
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
