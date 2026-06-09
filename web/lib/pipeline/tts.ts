import { isNull, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { getConfigValue } from "@/lib/db/repo/channel-config";
import { getLatestVideoContent } from "@/lib/db/repo/video-content";
import { updateVideoAudioUrl } from "@/lib/db/repo/videos";
import { notify } from "@/lib/notifications";

const TTS_BASE_URL = "https://api.ai33.pro";
const HARDCODED_DEFAULT_VOICE = "clone_2572202"; // Tenpu Nakamura
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 120_000; // 2 minutes — Vercel function max 5 min, cron max 5 min

// ---------------------------------------------------------------------------
// P3 parsing
// ---------------------------------------------------------------------------

/**
 * Strips the P3 script down to just the TTS narration:
 *   1. Drops the first line if it matches "総文字数：N文字"
 *   2. Drops everything from "チャプター設計" onward (chapter design section)
 *   3. Strips emotion-tag wrappers {calm}, {/calm}, {serious}, {/serious} etc.
 *      (keeps the text inside, removes only the tag markers themselves)
 *   4. Keeps <#N.N#> pause markers — AI33.PRO Vivoo V3 supports them natively
 *   5. Trims and collapses consecutive blank lines
 */
export function parseP3ForTTS(raw: string): string {
  let text = raw;

  // 1. Drop header line "総文字数：N文字"
  text = text.replace(/^総文字数：\d+文字\s*\n?/, "");

  // 2. Drop chapter design section and everything after it
  const chapterIdx = text.indexOf("チャプター設計");
  if (chapterIdx !== -1) {
    text = text.slice(0, chapterIdx);
  }

  // 3. Strip {tag} and {/tag} wrappers (e.g. {calm}, {/calm}, {serious}, {/serious})
  //    Keep the text between them; only remove the markers themselves.
  text = text.replace(/\{\/?\w+\}/g, "");

  // 4. <#N.N#> pause markers are kept as-is (no replacement needed)

  // 5. Trim and normalise whitespace
  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

// ---------------------------------------------------------------------------
// Voice routing
// ---------------------------------------------------------------------------

/**
 * Maps a `featured_person` value (English/Latinised, as stored in the DB) to
 * an AI33.PRO clone voice ID.
 *
 * Lookup order:
 *   1. `tts_voice_map` JSON from channel_config  (case-insensitive partial match)
 *   2. `tts_default_voice` from channel_config
 *   3. Hardcoded fallback: Tenpu Nakamura (clone_2572202)
 */
export async function getVoiceId(featuredPerson: string | null): Promise<string> {
  const mapJson = await getConfigValue("tts_voice_map");
  const defaultVoice = await getConfigValue("tts_default_voice");

  if (mapJson && featuredPerson) {
    try {
      const map = JSON.parse(mapJson) as Record<string, string>;
      const needle = featuredPerson.toLowerCase();
      // Exact match first
      const exactKey = Object.keys(map).find((k) => k.toLowerCase() === needle);
      if (exactKey) return map[exactKey];
      // Partial match (e.g. "Matsushita" matches "Konosuke Matsushita")
      const partialKey = Object.keys(map).find(
        (k) => k.toLowerCase().includes(needle) || needle.includes(k.toLowerCase()),
      );
      if (partialKey) return map[partialKey];
    } catch {
      console.warn("[tts] Failed to parse tts_voice_map JSON, using default voice.");
    }
  }

  return defaultVoice ?? HARDCODED_DEFAULT_VOICE;
}

// ---------------------------------------------------------------------------
// AI33.PRO API calls
// ---------------------------------------------------------------------------

/**
 * Submits a TTS job to AI33.PRO Vivoo V3.
 * Auth: `Authorization: <key>` — NO "Bearer" prefix per the API docs.
 * Content-Type is NOT set manually — the browser/Node FormData sets it with boundary.
 */
export async function submitTTS(text: string, voiceId: string): Promise<string> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) throw new Error("[tts] VIVOO_API_KEY env var is not set");

  const form = new FormData();
  form.append("text", text);
  form.append("voice_id", voiceId);
  form.append("speed", "1");

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
 * Returns the `audio_url` string on success.
 * Throws on API error or timeout.
 */
export async function pollTTSTask(
  taskId: string,
  maxWaitMs: number = MAX_WAIT_MS,
): Promise<string> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) throw new Error("[tts] VIVOO_API_KEY env var is not set");

  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${TTS_BASE_URL}/v3/task/${taskId}`, {
      headers: { Authorization: apiKey },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`[tts] pollTTSTask HTTP ${res.status}: ${body}`);
    }

    const json = (await res.json()) as {
      status?: string;
      audio_url?: string;
      error?: string;
    };

    if (json.status === "done") {
      if (!json.audio_url) throw new Error(`[tts] Task ${taskId} done but no audio_url`);
      return json.audio_url;
    }

    if (json.status === "error") {
      throw new Error(`[tts] Task ${taskId} failed: ${json.error ?? "unknown"}`);
    }

    // status: "pending" | "processing" — keep polling
  }

  throw new Error(`[tts] Task ${taskId} did not complete within ${maxWaitMs / 1000}s`);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface TTSVideoResult {
  videoId: number;
  ok: boolean;
  audioUrl?: string;
  error?: string;
}

export interface TTSRunResult {
  processed: number;
  results: TTSVideoResult[];
}

/**
 * Finds all `ready_to_publish` videos without an audio_url, generates TTS
 * audio for each using the P3 script + matched clone voice, and saves the
 * result back to `videos.audio_url`.
 *
 * Idempotent: skips any video that already has audio_url set.
 * Processes at most 5 videos per call to stay within Vercel function limits.
 * If a video times out, audio_url stays NULL → will retry on the next cron tick.
 */
export async function runTTSForReadyVideos(): Promise<TTSRunResult> {
  // Query videos ready for TTS: ready_to_publish AND audio_url IS NULL
  const pending = await db
    .select()
    .from(videos)
    .where(
      // Use raw SQL-style approach: status = ready_to_publish AND audio_url IS NULL
      eq(videos.status, "ready_to_publish"),
    )
    .limit(10); // fetch 10, filter below for null audioUrl

  const toProcess = pending.filter((v) => v.audioUrl === null || v.audioUrl === undefined).slice(0, 5);

  if (toProcess.length === 0) {
    return { processed: 0, results: [] };
  }

  const results: TTSVideoResult[] = [];

  for (const video of toProcess) {
    try {
      // Get the latest P3 content
      const p3Content = await getLatestVideoContent(video.id, "P3");
      if (!p3Content) {
        results.push({ videoId: video.id, ok: false, error: "No P3 content found" });
        continue;
      }

      // Parse P3 → clean narration text
      const ttsText = parseP3ForTTS(p3Content.output);
      if (!ttsText) {
        results.push({ videoId: video.id, ok: false, error: "P3 parsed to empty string" });
        continue;
      }

      // Get voice for this video's featured person
      const voiceId = await getVoiceId(video.featuredPerson);

      // Submit TTS job
      const taskId = await submitTTS(ttsText, voiceId);

      // Poll until done
      const audioUrl = await pollTTSTask(taskId);

      // Save to DB
      await updateVideoAudioUrl(video.id, audioUrl);

      results.push({ videoId: video.id, ok: true, audioUrl });
      console.log(`[tts] Video #${video.id} (${video.featuredPerson}) → ${audioUrl}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[tts] Video #${video.id} failed:`, error);
      results.push({ videoId: video.id, ok: false, error });
    }
  }

  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  // Notify if anything happened
  if (results.length > 0) {
    const lines = [
      `🎙️ TTS: ${succeeded.length} audio generated, ${failed.length} failed`,
      ...succeeded.map((r) => `  ✓ Video #${r.videoId}`),
      ...failed.map((r) => `  ✗ Video #${r.videoId}: ${r.error}`),
    ];
    await notify(lines.join("\n")).catch(() => {});
  }

  return { processed: succeeded.length, results };
}
