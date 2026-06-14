import { getAhConfigValue } from "@/lib/db/repo/channel-config";
import { listInPipelineAhVideos, updateAhVideoFields, updateAhVideoStatus } from "@/lib/db/repo/videos";
import { transcribeAudio } from "./whisper";
import { enqueueAhStage } from "./createJob";

const TTS_BASE_URL = "https://api.ai33.pro";
// Sentinel prefix stored in audio_url while TTS is pending
const TTS_TASK_PREFIX = "tts_task:";

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
  if (data.status === "error") {
    return { status: "error", message: `[tts] Task failed: ${data.error ?? "unknown"}` };
  }
  // "pending" | "processing"
  return { status: "running" };
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

    // ── Phase 1: submit TTS (if not yet submitted) ─────────────────────────
    if (!video.audioUrl) {
      const voiceId = await getAhVoiceId(video.voiceId);
      await submitAndSaveTTSTask(videoId, video.script, voiceId);
      return true;
    }

    // ── Phase 2: poll pending task (one check per cycle) ───────────────────
    if (video.audioUrl.startsWith(TTS_TASK_PREFIX)) {
      const taskId = video.audioUrl.slice(TTS_TASK_PREFIX.length);
      const result = await checkTTSTask(taskId);

      if (result.status === "running") {
        console.log(`[tts] Video #${videoId} task ${taskId} still running — next cycle`);
        return false;
      }

      if (result.status === "error") {
        console.warn(`[tts] Video #${videoId} primary TTS error: ${result.message}`);
        await cancelTTSTask(taskId);

        const backupVoiceId = await getAhBackupVoiceId();
        if (backupVoiceId) {
          console.log(`[tts] Failing over to backup voice: ${backupVoiceId}`);
          // Clear the failed task sentinel so next cycle submits fresh via backup
          await updateAhVideoFields(videoId, { audioUrl: `${TTS_TASK_PREFIX}backup_pending` });
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
    console.error(`[tts] Video #${videoId} failed:`, err);
    await updateAhVideoStatus(videoId, "needs_attention");
    return false;
  }
}
