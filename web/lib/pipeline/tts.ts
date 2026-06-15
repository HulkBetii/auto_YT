import { and, isNull, isNotNull, eq, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { getConfigValue } from "@/lib/db/repo/channel-config";
import { getLatestVideoContent } from "@/lib/db/repo/video-content";
import { updateVideoAudioUrl, setVideoTtsTaskId, clearVideoTtsTaskId } from "@/lib/db/repo/videos";
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
  /承知しました[^\n]*/,          // "承知しました..."
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
      text = text.replace(new RegExp(`^${pat.source}\\n?`, pat.flags), "");
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

  // 4b. Strip lines that contain ONLY pause tag(s) and nothing else — these
  //     are ChatGPT hallucinating the example list from the prompt verbatim.
  //     A legitimate pause tag is always attached to the end of a sentence.
  text = text
    .split("\n")
    .filter((line) => !/^(\s*<#[\d.]+#>\s*)+$/.test(line))
    .join("\n");

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
 * Submits a TTS job to AI33.PRO.
 * Auth: `xi-api-key: <key>` header for all endpoints.
 *
 * Routing by voice prefix:
 *   elevenlabs_* → POST /v1/text-to-speech/{voice_id}  (JSON body, no speed param)
 *   clone_*      → POST /v1m/task/text-to-speech        (JSON body, Minimax with speed)
 */
export async function submitTTS(text: string, voiceId: string): Promise<string> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) throw new Error("[tts] VIVOO_API_KEY env var is not set");

  const headers = { "xi-api-key": apiKey, "Content-Type": "application/json" };

  // Resolve voice type from voiceId:
  //   elevenlabs_* prefix → ElevenLabs (strip prefix to get raw ID)
  //   clone_* prefix     → Minimax clone (strip prefix to get numeric ID)
  //   pure digits        → Minimax clone (no prefix in DB for legacy entries)
  //   alphanumeric       → ElevenLabs (no prefix in DB for legacy entries)
  let elVoiceId: string | null = null;
  let cloneVoiceId: string | null = null;
  if (voiceId.startsWith("elevenlabs_")) {
    elVoiceId = voiceId.replace("elevenlabs_", "");
  } else if (voiceId.startsWith("clone_")) {
    cloneVoiceId = voiceId.replace("clone_", "");
  } else if (/^\d+$/.test(voiceId)) {
    cloneVoiceId = voiceId;
  } else {
    elVoiceId = voiceId;
  }

  let res: Response;
  if (elVoiceId !== null) {
    res = await fetch(`${TTS_BASE_URL}/v1/text-to-speech/${elVoiceId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    });
  } else {
    res = await fetch(`${TTS_BASE_URL}/v1m/task/text-to-speech`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text,
        model: "speech-2.6-hd",
        voice_setting: { voice_id: cloneVoiceId, speed: 1 },
        language_boost: "Auto",
      }),
    });
  }

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
 * Polls GET /v1/task/<taskId> every 5s until status=done or timeout.
 * Returns the `audio_url` string on success.
 * Throws on API error or timeout.
 *
 * Response shape (flat, no "data" wrapper):
 *   { id, status: "done"|"doing"|"pending"|"error", metadata: { audio_url }, error_message }
 */
export async function pollTTSTask(
  taskId: string,
  maxWaitMs: number = MAX_WAIT_MS,
): Promise<string> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) throw new Error("[tts] VIVOO_API_KEY env var is not set");

  const deadline = Date.now() + maxWaitMs;
  let transientErrors = 0;
  const MAX_TRANSIENT = 5;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let res: Response;
    try {
      res = await fetch(`${TTS_BASE_URL}/v1/task/${taskId}`, {
        headers: { "xi-api-key": apiKey },
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
      console.warn(`[tts] pollTTSTask HTTP ${res.status} (${transientErrors}/${MAX_TRANSIENT}): ${body}`);
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

    // Flat response shape — no "data" wrapper
    const json = (await res.json()) as {
      id?: string;
      status?: string;
      metadata?: { audio_url?: string };
      error_message?: string;
    };

    if (json.status === "done") {
      const audioUrl = json.metadata?.audio_url;
      if (!audioUrl) throw new Error(`[tts] Task ${taskId} done but no audio_url`);
      return audioUrl;
    }

    if (json.status === "error") {
      throw new Error(`[tts] Task ${taskId} failed: ${json.error_message ?? "unknown"}`);
    }

    // status: "doing" | "pending" — keep polling
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
 * Deduplication via tts_task_id:
 *  - If tts_task_id IS NOT NULL → an in-flight task already exists; poll it
 *    instead of submitting a new one.
 *  - If tts_task_id IS NULL → submit a new task and immediately save the
 *    task_id so the next cron tick won't duplicate it.
 *
 * Idempotent: skips any video that already has audio_url set.
 * Processes at most 1 video per call to stay within Vercel function limits.
 * If a video times out, audio_url stays NULL but tts_task_id is cleared so
 * the next tick can safely retry.
 */
export async function runTTSForReadyVideos(): Promise<TTSRunResult> {
  // Pick: in-flight task first (poll before submitting new ones), then pending.
  // Both must have audio_url IS NULL — the tts_task_id check separates the two paths.
  const toProcess = await db
    .select()
    .from(videos)
    .where(
      and(
        isNull(videos.audioUrl),
        or(
          // Path A: in-flight — already submitted, just need to poll
          isNotNull(videos.ttsTaskId),
          // Path B: ready to submit — ready_to_publish and no task yet
          and(eq(videos.status, "ready_to_publish"), isNull(videos.ttsTaskId)),
        ),
      ),
    )
    .orderBy(videos.id)
    .limit(1);

  if (toProcess.length === 0) {
    return { processed: 0, results: [] };
  }

  const results: TTSVideoResult[] = [];

  for (const video of toProcess) {
    try {
      let taskId = video.ttsTaskId ?? null;

      if (!taskId) {
        // Path B: need to submit a new TTS task

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

        // Submit and immediately persist task_id to prevent duplicates on next tick
        taskId = await submitTTS(ttsText, voiceId);
        await setVideoTtsTaskId(video.id, taskId);
        console.log(`[tts] Video #${video.id} submitted task ${taskId}`);
      } else {
        console.log(`[tts] Video #${video.id} resuming in-flight task ${taskId}`);
      }

      // Poll until done (Path A or B both land here)
      let audioUrl: string;
      try {
        audioUrl = await pollTTSTask(taskId);
      } catch (pollErr) {
        // On timeout or error, clear the task_id so the next tick can retry cleanly
        await clearVideoTtsTaskId(video.id);
        throw pollErr;
      }

      // Save audio_url (also clears tts_task_id via updateVideoAudioUrl)
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
