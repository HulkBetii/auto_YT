import { getAhConfigValue } from "@/lib/db/repo/channel-config";
import { listInPipelineAhVideos, updateAhVideoFields, updateAhVideoStatus } from "@/lib/db/repo/videos";
import { transcribeAudio } from "./whisper";
import { enqueueAhStage } from "./createJob";

const TTS_BASE_URL = "https://api.ai33.pro";
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 240_000;

export async function getAhVoiceId(videoVoiceId: string | null): Promise<string> {
  if (videoVoiceId) return videoVoiceId;
  const configured = await getAhConfigValue("voice_id");
  if (configured) return configured;
  throw new Error("[tts] No voice_id configured. Set it in Settings or on the video.");
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
 * Polls GET /v3/task/<taskId> every 5s until status=done or timeout.
 */
export async function pollTTSTask(taskId: string, maxWaitMs = MAX_WAIT_MS): Promise<string> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) throw new Error("[tts] VIVOO_API_KEY env var is not set");

  const deadline = Date.now() + maxWaitMs;
  let transientErrors = 0;
  const MAX_TRANSIENT = 5;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let res: Response;
    try {
      res = await fetch(`${TTS_BASE_URL}/v3/task/${taskId}`, {
        headers: { Authorization: apiKey },
      });
    } catch (networkErr) {
      transientErrors++;
      console.warn(`[tts] pollTTSTask network error (${transientErrors}/${MAX_TRANSIENT}):`, networkErr);
      if (transientErrors >= MAX_TRANSIENT) {
        throw new Error(`[tts] pollTTSTask: ${MAX_TRANSIENT} consecutive network errors on task ${taskId}`);
      }
      continue;
    }

    if (res.status >= 500) {
      const body = await res.text().catch(() => "");
      transientErrors++;
      if (transientErrors >= MAX_TRANSIENT) {
        throw new Error(`[tts] pollTTSTask HTTP ${res.status} after ${MAX_TRANSIENT} retries: ${body}`);
      }
      continue;
    }
    transientErrors = 0;

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`[tts] pollTTSTask HTTP ${res.status}: ${body}`);
    }

    const json = (await res.json()) as {
      success?: boolean;
      data?: { status?: string; metadata?: { audio_url?: string }; error?: string };
    };

    const data = json.data;
    if (!data) throw new Error(`[tts] Unexpected response shape: ${JSON.stringify(json)}`);

    if (data.status === "done") {
      const audioUrl = data.metadata?.audio_url;
      if (!audioUrl) throw new Error(`[tts] Task ${taskId} done but no audio_url`);
      return audioUrl;
    }

    if (data.status === "error") {
      throw new Error(`[tts] Task ${taskId} failed: ${data.error ?? "unknown"}`);
    }
    // status: "pending" | "processing" — keep polling
  }

  throw new Error(`[tts] Task ${taskId} did not complete within ${maxWaitMs / 1000}s`);
}

/**
 * Finds the oldest ah_video in status='tts_pending' with no audio_url,
 * runs TTS → saves audioUrl → runs Whisper → saves transcript → advances to s3_pending.
 * Returns true if a video was processed.
 */
export async function runTTSAndWhisperForPendingVideo(): Promise<boolean> {
  // Pick the oldest tts_pending video that still needs work:
  // - no audioUrl → TTS hasn't run yet
  // - audioUrl set but no whisperTranscript → TTS succeeded but Whisper crashed last time
  const videos = await listInPipelineAhVideos();
  const video =
    videos.find((v) => v.status === "tts_pending" && (!v.audioUrl || !v.whisperTranscript)) ??
    null;

  if (!video) return false;

  const videoId = video.id;

  try {
    if (!video.script) {
      console.error(`[tts] Video #${videoId} has no script — cannot run TTS`);
      await updateAhVideoStatus(videoId, "needs_attention");
      return false;
    }

    let audioUrl = video.audioUrl;

    // Only submit TTS if we don't already have an audio URL from a previous partial run
    if (!audioUrl) {
      const voiceId = await getAhVoiceId(video.voiceId);
      const taskId = await submitTTS(video.script, voiceId);
      audioUrl = await pollTTSTask(taskId);
      await updateAhVideoFields(videoId, { audioUrl });
    }

    // Whisper (always re-run if transcript is missing, even if audio was already saved)
    const whisperTranscript = await transcribeAudio(audioUrl);
    await updateAhVideoFields(videoId, { whisperTranscript });

    // Advance → S3
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

    console.log(`[tts] Video #${videoId} → audioUrl saved, transcript saved, S3 enqueued`);
    return true;
  } catch (err) {
    console.error(`[tts] Video #${videoId} TTS/Whisper failed:`, err);
    await updateAhVideoStatus(videoId, "needs_attention");
    return false;
  }
}
