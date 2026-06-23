import { getDrConfigValue } from "@/lib/db/repo/channel-config";
import {
  claimEpisodeForSuno,
  listInPipelineDrEpisodes,
  releaseEpisodeSunoLock,
  updateDrEpisodeFields,
  updateDrEpisodeStatus,
} from "@/lib/db/repo/episodes";
import {
  DR_CONFIG_KEYS,
  type AmbientSoundMap,
  type AudioClip,
  type EpisodeTrackAudio,
  type TrackSpec,
} from "@/lib/db/schema";
import { notify } from "@/lib/notifications";
import { enqueueDrStage } from "./createJob";

const SUNO_BASE_URL = "https://api.ai33.pro";
const DEFAULT_MODEL_VERSION = "v4.5-all";
// One cron cycle drives the fan-out at a time; lease expires if it crashes.
const SUNO_LEASE_MS = 2 * 60 * 1000;
// Max tracks submitted per cycle — throttles Suno credit burn and API load.
const SUBMIT_BATCH = 5;
// AI33.PRO caps concurrent queued Suno tasks (HTTP 429 "too many tasks in queue
// (10/10)"). Stay under it so submits succeed; the rest wait as pending.
const MAX_IN_FLIGHT = 8;

function isRateLimited(msg: string): boolean {
  return msg.includes("429") || msg.toLowerCase().includes("too many tasks");
}
// Title/lyrics/tags hard limits per the AI33.PRO Suno docs.
const MAX_TITLE = 80;
const MAX_LYRICS = 5000;
const MAX_TAGS = 1000;

const SUNO_FAILED_STATUSES = new Set(["failed", "error", "cancelled", "canceled"]);

interface SunoCheckResult {
  status: "done" | "running" | "error";
  clips?: Array<{ url: string; durationSec: number }>;
  message?: string;
}

function getSunoApiKey(): string {
  const key = process.env.SUNO_API_KEY;
  if (!key) throw new Error("[suno] SUNO_API_KEY env var is not set");
  return key;
}

async function getModelVersion(): Promise<string> {
  return (await getDrConfigValue(DR_CONFIG_KEYS.sunoModelVersion)) || DEFAULT_MODEL_VERSION;
}

/** Submits one custom-mode Suno generation. Returns its task_id. */
export async function submitSuno(spec: TrackSpec, modelVersion: string): Promise<string> {
  const res = await fetch(`${SUNO_BASE_URL}/v1s/task/music-generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": getSunoApiKey() },
    body: JSON.stringify({
      create_mode: "custom",
      title: spec.title.slice(0, MAX_TITLE),
      lyrics: spec.structure.slice(0, MAX_LYRICS),
      tags: spec.style_tags.slice(0, MAX_TAGS),
      major_model_version: modelVersion,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[suno] submit HTTP ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { task_id?: string; success?: boolean };
  if (!json.task_id) {
    throw new Error(`[suno] submit: no task_id in response: ${JSON.stringify(json)}`);
  }
  return json.task_id;
}

/** Polls one Suno task. Keeps ALL returned clips (1 or 2). */
export async function checkSuno(taskId: string): Promise<SunoCheckResult> {
  let res: Response;
  try {
    res = await fetch(`${SUNO_BASE_URL}/v1/task/${taskId}`, {
      headers: { "Content-Type": "application/json", "xi-api-key": getSunoApiKey() },
    });
  } catch (err) {
    // Network blip — keep the task running and retry on the next cycle.
    console.warn(`[suno] poll network error (transient): ${String(err)}`);
    return { status: "running" };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Rate-limit / server errors are transient — do not kill the in-flight task.
    if (res.status === 429 || res.status >= 500) {
      console.warn(`[suno] poll HTTP ${res.status} (transient): ${body}`);
      return { status: "running" };
    }
    return { status: "error", message: `[suno] HTTP ${res.status}: ${body}` };
  }

  const json = (await res.json()) as {
    status?: string;
    error_message?: string;
    metadata?: {
      audio_url?: string;
      all_audio_urls?: string[];
      suno_result?: { clips?: Array<{ audio_url?: string; duration?: number }> };
    };
  };

  if (json.status === "done") {
    const rawClips = json.metadata?.suno_result?.clips ?? [];
    let clips = rawClips
      .filter((c) => c.audio_url)
      .map((c) => ({ url: c.audio_url as string, durationSec: Math.round(c.duration ?? 0) }));

    // Fallback: some responses only populate all_audio_urls (no per-clip duration).
    if (clips.length === 0 && json.metadata?.all_audio_urls?.length) {
      clips = json.metadata.all_audio_urls.map((url) => ({ url, durationSec: 0 }));
    }

    if (clips.length === 0) {
      return { status: "error", message: `[suno] task ${taskId} done but no audio clips` };
    }
    return { status: "done", clips };
  }

  if (json.status && SUNO_FAILED_STATUSES.has(json.status)) {
    return { status: "error", message: `[suno] task failed: ${json.status} — ${json.error_message ?? ""}` };
  }
  return { status: "running" };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** dr_e{episodeId}_t{NN}_{clipIdx}_{ddmmyyyy}_{hhmmss}.mp3 — the RUN_VEO-style
 * name the local assembler picks up, ordered by spec then clip. */
function buildClipFileName(episodeId: number, specIndex: number, clipIdx: number): string {
  const now = new Date();
  const dd = pad2(now.getDate());
  const mm = pad2(now.getMonth() + 1);
  const yyyy = now.getFullYear();
  const hh = pad2(now.getHours());
  const min = pad2(now.getMinutes());
  const ss = pad2(now.getSeconds());
  return `dr_e${episodeId}_t${pad2(specIndex + 1)}_${clipIdx + 1}_${dd}${mm}${yyyy}_${hh}${min}${ss}.mp3`;
}

// ── Primary clip selection (#4) ──────────────────────────────────────────────
const DEFAULT_MIN_CLIP_SEC = 60;
const AMBIENT_BED_ROLE = "Ambient Bed";

// Target duration window (seconds) per role; selection prefers a clip inside it,
// and on ties prefers the longer clip. The ambient bed wants the longest take.
const ROLE_TARGET_RANGE: Record<string, [number, number]> = {
  "Short Noir Intro": [90, 180],
  "Dark Jazz Deep Focus": [180, 300],
  "Dark Jazz Sleep Noir": [300, 600],
  [AMBIENT_BED_ROLE]: [240, 600],
};

/** Picks the clip whose duration best fits the role's window; drops clips under
 * MIN_CLIP_SEC unless none qualify (then keeps the longest + warns). */
function selectPrimaryClipIndex(clips: AudioClip[], role: string, minClipSec: number): number {
  if (clips.length === 0) return -1;
  const [min, max] = ROLE_TARGET_RANGE[role] ?? [minClipSec, 600];
  const indexed = clips.map((c, i) => ({ i, d: c.durationSec }));
  let pool = indexed.filter((x) => x.d >= minClipSec);
  if (pool.length === 0) {
    console.warn(`[suno] all clips for role "${role}" under ${minClipSec}s — keeping longest`);
    pool = indexed;
  }
  let best = pool[0];
  let bestDist = Infinity;
  for (const x of pool) {
    const dist = x.d < min ? min - x.d : x.d > max ? x.d - max : 0;
    if (dist < bestDist || (dist === bestDist && x.d > best.d)) {
      best = x;
      bestDist = dist;
    }
  }
  return best.i;
}

/** Code-built Suno spec for the dedicated ambience bed (no instruments/melody). */
function buildAmbientBedSpec(a: AmbientSoundMap): TrackSpec {
  return {
    title: "Ambient Bed",
    role: AMBIENT_BED_ROLE,
    youtube_use_case: "Rainy Night",
    style_tags: `${a.ambient_bed}, ${a.tonal_hum}, ${a.rhythmic_texture}, field recording ambience, looping background atmosphere, no music, no melody, no drums, no chords, no instruments, Instrumental only, No vocals, No lyrics`,
    structure: `[Instrumental Only][No Vocals][No Lyrics][No Spoken Word][Ambient Field Recording]\n[SFX: ${a.ambient_bed}]\n[SFX: ${a.tonal_hum}]\n[SFX: ${a.rhythmic_texture}]\n[Continuous looping background atmosphere — no musical instruments, no melody, no drums]`,
    mix_notes: "",
    transition_note: "",
  };
}

export async function describePendingSunoWait(): Promise<string | null> {
  const episodes = await listInPipelineDrEpisodes();
  const ep = episodes.find((e) => e.status === "suno_pending");
  if (!ep) return null;
  const audio = (ep.audio as EpisodeTrackAudio[] | null) ?? [];
  const bed = ep.ambientBedAudio as EpisodeTrackAudio | null;
  const all = bed ? [...audio, bed] : audio;
  const done = all.filter((t) => t.status === "done").length;
  const running = all.filter((t) => t.status === "running").length;
  const pending = all.filter((t) => t.status === "pending").length;
  return `Episode #${ep.id} Suno: ${done} done, ${running} running, ${pending} pending of ${all.length} (incl. ambient bed).`;
}

/**
 * Fire-and-poll Suno fan-out — safe for short-lived serverless functions.
 * Each cycle (under a lease): polls all in-flight tracks, then submits up to
 * SUBMIT_BATCH pending tracks. When every track is done → advance to D3.
 */
export async function runSunoForPendingEpisode(): Promise<boolean> {
  const episodes = await listInPipelineDrEpisodes();
  const ep = episodes.find((e) => e.status === "suno_pending");
  if (!ep) return false;

  // Hold the (credit-spending) music fan-out when explicitly paused.
  if ((await getDrConfigValue(DR_CONFIG_KEYS.sunoPaused)) === "true") {
    return false;
  }

  const claimed = await claimEpisodeForSuno(ep.id, SUNO_LEASE_MS);
  if (!claimed) {
    console.log(`[suno] Episode #${ep.id} already leased by another cycle — skipping`);
    return false;
  }

  try {
    const audio = ep.audio as EpisodeTrackAudio[] | null;
    const specs = ep.trackSpecs as TrackSpec[] | null;
    const bed = ep.ambientBedAudio as EpisodeTrackAudio | null;
    const ambient = ep.ambientSoundMap as AmbientSoundMap | null;
    if (!audio?.length || !specs?.length) {
      await updateDrEpisodeStatus(ep.id, "needs_attention");
      await notify(`🔴 Episode #${ep.id} reached Suno with no track specs — needs review.`);
      return false;
    }

    const modelVersion = await getModelVersion();
    const minClipSec = Number(await getDrConfigValue(DR_CONFIG_KEYS.minClipSec)) || DEFAULT_MIN_CLIP_SEC;
    let changed = false;

    // The 20 playlist tracks + the single ambience bed are driven by one loop.
    const all: EpisodeTrackAudio[] = bed ? [...audio, bed] : audio;
    const specFor = (t: EpisodeTrackAudio): TrackSpec | null =>
      t.specIndex === -1 ? (ambient ? buildAmbientBedSpec(ambient) : null) : (specs[t.specIndex] ?? null);

    // 1. Poll every in-flight task once; on completion run the primary selection.
    for (const track of all.filter((t) => t.status === "running" && t.taskId)) {
      const res = await checkSuno(track.taskId!);
      if (res.status === "done" && res.clips) {
        track.clips = res.clips.map(
          (c, idx): AudioClip => ({
            url: c.url,
            durationSec: c.durationSec,
            fileName: buildClipFileName(ep.id, track.specIndex, idx),
          }),
        );
        track.primaryClipIndex = selectPrimaryClipIndex(track.clips, track.role, minClipSec);
        track.status = "done";
        changed = true;
      } else if (res.status === "error") {
        track.status = "error";
        track.errorMessage = res.message;
        changed = true;
      }
    }

    // 2. Submit pending tasks, staying under the concurrent-task cap.
    const runningCount = all.filter((t) => t.status === "running").length;
    const slots = Math.max(0, Math.min(SUBMIT_BATCH, MAX_IN_FLIGHT - runningCount));
    const pending = all.filter((t) => t.status === "pending");
    let submitted = 0;
    for (const track of pending) {
      if (submitted >= slots) break;
      const spec = specFor(track);
      if (!spec) {
        track.status = "error";
        track.errorMessage = `missing spec for track ${track.specIndex}`;
        changed = true;
        continue;
      }
      try {
        track.taskId = await submitSuno(spec, modelVersion);
        track.status = "running";
        changed = true;
        submitted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Rate-limited: the queue is full — leave this track pending and retry
        // next cycle instead of burning it as a hard failure.
        if (isRateLimited(msg)) {
          console.warn(`[suno] submit rate-limited — holding track ${track.specIndex} for next cycle`);
          break;
        }
        track.status = "error";
        track.errorMessage = msg;
        changed = true;
      }
    }

    if (changed) {
      await updateDrEpisodeFields(ep.id, { audio, ambientBedAudio: bed });
    }

    // 3. Finalize — advance only when the 20 tracks AND the ambience bed are done.
    const allDone = all.every((t) => t.status === "done");
    const anyError = all.some((t) => t.status === "error");
    const anyActive = all.some((t) => t.status === "pending" || t.status === "running");

    if (allDone) {
      const trackTitles = [...audio]
        .sort((a, b) => a.specIndex - b.specIndex)
        .map((t, i) => `${i + 1}. ${t.title}`)
        .join("\n");
      const scene = ep.sceneInput as { scene_name?: string } | null;
      await enqueueDrStage({
        promptKey: "D3",
        stage: "D3",
        vars: {
          SCENE_NAME: scene?.scene_name ?? "",
          VISUAL_HIGHLIGHTS:
            (ep.sceneInput as { visual_highlights?: string } | null)?.visual_highlights ?? "",
          ACCENT_COLOR: (ep.sceneInput as { accent_color?: string } | null)?.accent_color ?? "",
          TRACK_TITLES: trackTitles,
        },
        episodeId: ep.id,
      });
      await updateDrEpisodeStatus(ep.id, "d3_pending");
    } else if (anyError && !anyActive) {
      const errors = all
        .filter((t) => t.status === "error")
        .map((t) => `${t.specIndex === -1 ? "bed" : `#${t.specIndex + 1}`} ${t.errorMessage ?? "unknown"}`)
        .join("; ");
      await updateDrEpisodeStatus(ep.id, "needs_attention");
      await notify(`🔴 Episode #${ep.id} Suno failed: ${errors}`);
    }

    return changed;
  } finally {
    await releaseEpisodeSunoLock(ep.id).catch(() => {});
  }
}
