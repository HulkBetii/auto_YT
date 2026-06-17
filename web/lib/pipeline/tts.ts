import { and, isNull, isNotNull, eq, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { getConfigValue } from "@/lib/db/repo/channel-config";
import { getLatestVideoContent } from "@/lib/db/repo/video-content";
import { updateVideoAudioUrl, setVideoTtsTaskId, clearVideoTtsTaskId } from "@/lib/db/repo/videos";
import { notify } from "@/lib/notifications";

const TTS_BASE_URL = "https://api.ai33.pro";
// Stale threshold — if a task has been "doing" for longer than this, cancel and retry
const MAX_TTS_AGE_MS = 15 * 60 * 1000; // 15 minutes (~3 cron cycles)

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

// AI33 statuses that mean "still working"
const TTS_RUNNING_STATUSES = new Set(["pending", "doing", "processing", "queued"]);

type TtsTaskCheckResult =
  | { status: "done"; audioUrl: string }
  | { status: "running" }
  | { status: "error"; message: string };

/**
 * Checks a TTS task status ONCE — no polling loop, safe for short-lived functions.
 * Returns done/running/error so the caller decides what to do next cron cycle.
 */
export async function checkTTSTask(taskId: string): Promise<TtsTaskCheckResult> {
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
  return { status: "error", message: `[tts] Task ${taskId} status=${json.status} — ${json.error_message ?? ""}` };
}

/**
 * Cancels a TTS task to release frozen credits. Fire-and-forget safe.
 */
export async function cancelTTSTask(taskId: string): Promise<void> {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) return;
  try {
    const res = await fetch(`${TTS_BASE_URL}/v1/task/delete`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ task_ids: [taskId] }),
    });
    const json = (await res.json()) as { success?: boolean; refunded_credits?: number };
    console.log(`[tts] cancelTTSTask ${taskId} → refunded ${json.refunded_credits ?? 0} credits`);
  } catch (err) {
    console.warn(`[tts] cancelTTSTask ${taskId} failed (credits may stay frozen):`, err);
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Blocking poll helper for local scripts only — not for use in serverless functions.
 * Wraps checkTTSTask in a loop with configurable timeout.
 */
export async function pollTTSTask(taskId: string, maxWaitMs = 240_000): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  const INTERVAL = 5_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, INTERVAL));
    const result = await checkTTSTask(taskId);
    if (result.status === "done") return result.audioUrl;
    if (result.status === "error") throw new Error(result.message);
    // "running" — keep polling
  }
  throw new Error(`[tts] Task ${taskId} did not complete within ${maxWaitMs / 1000}s`);
}

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
 * Fire-and-poll TTS runner — safe for short-lived serverless functions.
 *
 * Each cron tick does exactly ONE async operation per video:
 *
 *  Path A — no task yet (tts_task_id IS NULL, status=ready_to_publish):
 *    → submit TTS, save tts_task_id + tts_submitted_at, return immediately.
 *      Next tick will check the task.
 *
 *  Path B — in-flight task (tts_task_id IS NOT NULL):
 *    → check task status ONCE (no blocking loop):
 *       • running + age < 15 min → return, wait for next tick
 *       • running + age ≥ 15 min → cancel (refund credits) + clear task, next tick retries
 *       • done   → save audio_url, clear tts_task_id + tts_submitted_at
 *       • error  → cancel (refund credits) + clear task, next tick retries with same voice
 */
export async function runTTSForReadyVideos(): Promise<TTSRunResult> {
  const toProcess = await db
    .select()
    .from(videos)
    .where(
      and(
        isNull(videos.audioUrl),
        or(
          isNotNull(videos.ttsTaskId),
          and(eq(videos.status, "ready_to_publish"), isNull(videos.ttsTaskId)),
        ),
      ),
    )
    .orderBy(videos.id)
    .limit(3); // non-blocking now, safe to process multiple per tick

  if (toProcess.length === 0) {
    return { processed: 0, results: [] };
  }

  const results: TTSVideoResult[] = [];

  for (const video of toProcess) {
    try {
      if (!video.ttsTaskId) {
        // ── Path A: submit new TTS task ──────────────────────────────────────
        const p3Content = await getLatestVideoContent(video.id, "P3");
        if (!p3Content) {
          results.push({ videoId: video.id, ok: false, error: "No P3 content found" });
          continue;
        }

        const ttsText = parseP3ForTTS(p3Content.output);
        if (!ttsText) {
          results.push({ videoId: video.id, ok: false, error: "P3 parsed to empty string" });
          continue;
        }

        const voiceId = await getVoiceId(video.featuredPerson);
        if (!voiceId) {
          console.log(`[tts] Video #${video.id} (${video.featuredPerson}) — no voice mapping, skipping`);
          results.push({ videoId: video.id, ok: false, error: "no_voice_mapping" });
          continue;
        }

        const taskId = await submitTTS(ttsText, voiceId);
        await setVideoTtsTaskId(video.id, taskId); // also saves tts_submitted_at = now()
        console.log(`[tts] Video #${video.id} submitted task ${taskId} (voice: ${voiceId})`);
        results.push({ videoId: video.id, ok: false, error: "submitted" });
      } else {
        // ── Path B: check existing task once, no blocking loop ────────────────
        const taskId = video.ttsTaskId;
        const result = await checkTTSTask(taskId);

        if (result.status === "running") {
          const ageMs = video.ttsSubmittedAt
            ? Date.now() - new Date(video.ttsSubmittedAt).getTime()
            : MAX_TTS_AGE_MS + 1; // unknown age → treat as stale

          if (ageMs > MAX_TTS_AGE_MS) {
            console.warn(`[tts] Video #${video.id} task ${taskId} stuck ${Math.round(ageMs / 60000)}min — cancelling`);
            await cancelTTSTask(taskId);
            await clearVideoTtsTaskId(video.id);
            results.push({ videoId: video.id, ok: false, error: `stale_cancelled after ${Math.round(ageMs / 60000)}min` });
          } else {
            console.log(`[tts] Video #${video.id} task ${taskId} running (${Math.round(ageMs / 60000)}min) — next tick`);
            results.push({ videoId: video.id, ok: false, error: "running" });
          }
        } else if (result.status === "done") {
          await updateVideoAudioUrl(video.id, result.audioUrl); // clears tts_task_id + tts_submitted_at
          console.log(`[tts] Video #${video.id} (${video.featuredPerson}) ✓ ${result.audioUrl}`);
          results.push({ videoId: video.id, ok: true, audioUrl: result.audioUrl });
        } else {
          // error — cancel to reclaim frozen credits, clear so next tick can retry
          console.warn(`[tts] Video #${video.id} task ${taskId} error: ${result.message}`);
          await cancelTTSTask(taskId);
          await clearVideoTtsTaskId(video.id);
          results.push({ videoId: video.id, ok: false, error: result.message });
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[tts] Video #${video.id} failed:`, error);
      results.push({ videoId: video.id, ok: false, error });
    }
  }

  const succeeded = results.filter((r) => r.ok);
  const skipped = results.filter((r) => !r.ok && r.error === "no_voice_mapping");
  const notified = results.filter((r) => !r.ok && r.error !== "no_voice_mapping" && r.error !== "submitted" && r.error !== "running");

  if (succeeded.length > 0 || notified.length > 0) {
    const lines = [
      `TTS: ${succeeded.length} audio generated${notified.length > 0 ? `, ${notified.length} loi` : ""}`,
      ...succeeded.map((r) => `  + Video #${r.videoId}`),
      ...notified.map((r) => `  x Video #${r.videoId}: ${r.error}`),
    ];
    await notify(lines.join("\n")).catch(() => {});
  }
  if (skipped.length > 0) {
    console.log(`[tts] Skipped ${skipped.length} video(s) with no voice mapping`);
  }

  return { processed: succeeded.length, results };
}
