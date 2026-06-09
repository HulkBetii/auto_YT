import { and, isNull, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { getConfigValue } from "@/lib/db/repo/channel-config";
import { getLatestVideoContent } from "@/lib/db/repo/video-content";
import { updateVideoAudioUrl } from "@/lib/db/repo/videos";
import { notify } from "@/lib/notifications";

const TTS_BASE_URL = "https://api.ai33.pro";
const HARDCODED_DEFAULT_VOICE = "clone_2572202"; // Tenpu Nakamura
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 240_000; // 4 minutes — leaves ~1 min headroom within Vercel's 5 min cap

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
/**
 * Known non-narration preamble patterns that ChatGPT sometimes prepends.
 * Matched against the FIRST non-blank line of the remaining text, stripped
 * one-by-one until no more matches (order doesn't matter).
 */
/**
 * Patterns matched against the first non-blank line of the remaining text.
 * Do NOT include a leading `^` — it is added automatically in the loop below.
 * Flags (e.g. `i`) are preserved when constructing the final RegExp.
 */
const PREAMBLE_PATTERNS: RegExp[] = [
  /総文字数[：:][^\n]+/,         // "総文字数：約二千六百文字" (kanji or digit)
  /【[^】]+】[^\n]+/,            // "【田中角栄】タイトル..."
  /以下[、，,。][^\n]*/,         // "以下、条件に合わせた完全ナレーション台本です。"
  /Edit(?=\n|$)/i,                // ChatGPT "Edit" artifact (lone word on its own line)
  /Note[:\s：][^\n]*/i,           // "Note: ..."
  /Sure[,!、。\s][^\n]*/i,        // "Sure, here is..."
  /Here\s+is[^\n]*/i,             // "Here is the script..."
  /以下に[^\n]*/,                // "以下に完全な..."
  /では[、，,][^\n]*/,            // "では、ナレーション..."
  /承知[しました][^\n]*/,        // "承知しました..."
];

export function parseP3ForTTS(raw: string): string {
  let text = raw;

  // 1. Strip preamble lines from the top: repeatedly remove leading blank lines
  //    then check if the first non-blank line matches a known non-narration
  //    pattern. Loop until the top of the text is actual narration content.
  let prevText = "";
  while (prevText !== text) {
    prevText = text;
    text = text.replace(/^\n+/, ""); // collapse leading newlines
    for (const pat of PREAMBLE_PATTERNS) {
      text = text.replace(new RegExp(`^${pat.source}\\n?`), "");
    }
  }

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
 * Low-level helper: look up `featured_person` in the parsed voice map object.
 * Uses case-insensitive exact match first, then partial match.
 * Returns the clone voice ID, or null if no mapping exists.
 */
export function lookupVoiceInMap(
  map: Record<string, string>,
  featuredPerson: string,
): string | null {
  const needle = featuredPerson.toLowerCase();
  const exactKey = Object.keys(map).find((k) => k.toLowerCase() === needle);
  if (exactKey) return map[exactKey];
  const partialKey = Object.keys(map).find(
    (k) => k.toLowerCase().includes(needle) || needle.includes(k.toLowerCase()),
  );
  return partialKey ? map[partialKey] : null;
}

/**
 * Maps a `featured_person` value to an AI33.PRO clone voice ID.
 * Returns null if no mapping exists in `tts_voice_map` — does NOT fall back
 * to the default voice. Callers should skip TTS for null results and wait
 * until the operator adds a mapping via Settings.
 *
 * (`tts_default_voice` is kept in config for explicit operator use, not as
 * an automatic fallback for unknown persons.)
 */
export async function getVoiceId(featuredPerson: string | null): Promise<string | null> {
  if (!featuredPerson) return null;

  const mapJson = await getConfigValue("tts_voice_map");
  if (!mapJson) return null;

  try {
    const map = JSON.parse(mapJson) as Record<string, string>;
    return lookupVoiceInMap(map, featuredPerson);
  } catch {
    console.warn("[tts] Failed to parse tts_voice_map JSON");
    return null;
  }
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
  // Allow up to 5 consecutive transient 5xx / network errors before giving up.
  // 502/503/504 are CDN gateway glitches — the underlying task keeps running.
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

    // Treat 5xx as transient gateway errors — retry up to MAX_TRANSIENT times
    if (res.status >= 500) {
      const body = await res.text().catch(() => "");
      transientErrors++;
      console.warn(`[tts] pollTTSTask HTTP ${res.status} (${transientErrors}/${MAX_TRANSIENT}): ${body}`);
      if (transientErrors >= MAX_TRANSIENT) {
        throw new Error(`[tts] pollTTSTask HTTP ${res.status} after ${MAX_TRANSIENT} retries: ${body}`);
      }
      continue;
    }
    // Reset on a good response
    transientErrors = 0;

    if (!res.ok) {
      // 4xx — not transient, fail immediately
      const body = await res.text().catch(() => "");
      throw new Error(`[tts] pollTTSTask HTTP ${res.status}: ${body}`);
    }

    // Response shape: { success: true, data: { status, metadata: { audio_url }, ... } }
    const json = (await res.json()) as {
      success?: boolean;
      data?: {
        status?: string;
        metadata?: { audio_url?: string };
        error?: string;
      };
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
  // Clone voice synthesis takes ~4-5 min per video. Vercel functions cap at 5 min
  // (maxDuration=300). Process 1 video per call — cron fires every 5 min so all
  // ready_to_publish videos get audio within minutes×count ticks.
  const toProcess = await db
    .select()
    .from(videos)
    .where(and(eq(videos.status, "ready_to_publish"), isNull(videos.audioUrl)))
    .orderBy(videos.id)
    .limit(1);

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

      // Get voice for this video's featured person — skip if no mapping
      const voiceId = await getVoiceId(video.featuredPerson);
      if (!voiceId) {
        console.log(`[tts] Video #${video.id} (${video.featuredPerson}) — no voice mapping, skipping`);
        results.push({ videoId: video.id, ok: false, error: "no_voice_mapping" });
        continue;
      }

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
  const skipped = results.filter((r) => !r.ok && r.error === "no_voice_mapping");
  const failed = results.filter((r) => !r.ok && r.error !== "no_voice_mapping");

  // Only notify for real successes/failures (skip "no mapping" silently)
  if (succeeded.length > 0 || failed.length > 0) {
    const lines = [
      `🎙️ TTS: ${succeeded.length} audio generated${failed.length > 0 ? `, ${failed.length} lỗi` : ""}`,
      ...succeeded.map((r) => `  ✓ Video #${r.videoId}`),
      ...failed.map((r) => `  ✗ Video #${r.videoId}: ${r.error}`),
    ];
    await notify(lines.join("\n")).catch(() => {});
  }
  if (skipped.length > 0) {
    console.log(`[tts] Skipped ${skipped.length} video(s) with no voice mapping`);
  }

  return { processed: succeeded.length, results };
}
