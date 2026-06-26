import {
  listUnconsumedDoneDrJobs,
  listUnconsumedFailedDrJobs,
  markDrJobConsumed,
  markDrJobHandlerFailed,
  resetStaleRunningDrJobs,
} from "@/lib/db/repo/jobs";
import {
  getDrEpisode,
  updateDrEpisodeFields,
  updateDrEpisodeStatus,
} from "@/lib/db/repo/episodes";
import { getDrConfigValue, setDrConfigValue } from "@/lib/db/repo/channel-config";
import {
  DR_CONFIG_KEYS,
  type AmbientSoundMap,
  type EpisodeTrackAudio,
  type HarmonicPalette,
  type SceneInput,
  type TrackSpec,
} from "@/lib/db/schema";
import { extractJson } from "@/lib/utils/json";
import { notify } from "@/lib/notifications";
import { ensureManualEpisodeProjectDirs } from "@/lib/manual-image-project";
import {
  buildChaptersFromAudio,
  buildDescription,
  parseD4Variable,
  type YouTubeChapter,
} from "./descriptionBuilder";
import { formatHarmonicPalette, parseHarmonicPalette } from "./format";
import { enqueueDrStage } from "./createJob";
import { runLocalAssemblyWatcher, type LocalAssemblyResult } from "./localAssembly";

const DEFAULT_CROSSFADE_SEC = 3;
import { describePendingSunoWait, runSunoForPendingEpisode } from "./suno";

export interface DrChainCycleResult {
  processed: number;
  results: Array<{ jobId: number; stage: string; ok: boolean; error?: string }>;
  sunoRan: boolean;
  sunoWaiting: string | null;
  localAssembly: LocalAssemblyResult;
  staleReset: number;
}

type DoneJob = Awaited<ReturnType<typeof listUnconsumedDoneDrJobs>>[number];

// ── Formatting helpers (carry-forward via placeholders) ──────────────────────

function formatSceneInput(scene: SceneInput): string {
  return [
    `SCENE NAME: ${scene.scene_name}`,
    `VISUAL HIGHLIGHTS: ${scene.visual_highlights}`,
    `ATMOSPHERE / MOOD: ${scene.atmosphere_mood}`,
    `ACCENT COLOR: ${scene.accent_color}`,
    `MUSIC ROLE: ${scene.music_role}`,
  ].join("\n");
}

function formatAmbientSoundMap(a: AmbientSoundMap): string {
  return [
    `Ambient Bed: ${a.ambient_bed}`,
    `Tonal Hum: ${a.tonal_hum}`,
    `Rhythmic Texture: ${a.rhythmic_texture}`,
    `Human Trace: ${a.human_trace}`,
    `Silence Gap: ${a.silence_gap}`,
  ].join("\n");
}

const AMBIENT_KEYS: (keyof AmbientSoundMap)[] = [
  "ambient_bed",
  "tonal_hum",
  "rhythmic_texture",
  "human_trace",
  "silence_gap",
];

function validateAmbient(value: unknown): AmbientSoundMap {
  if (!value || typeof value !== "object") {
    throw new Error("D1 output missing ambient_sound_map object.");
  }
  const obj = value as Record<string, unknown>;
  for (const key of AMBIENT_KEYS) {
    if (typeof obj[key] !== "string" || !(obj[key] as string).trim()) {
      throw new Error(`D1 ambient_sound_map missing field: ${key}`);
    }
  }
  return obj as unknown as AmbientSoundMap;
}

function parseTrackSpecs(result: string, expected: number): TrackSpec[] {
  const raw = extractJson<TrackSpec[]>(result ?? "[]");
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("D2 output did not contain any track specs.");
  }
  // Hard-cap to the batch size so an over-eager LLM can't inflate the episode's
  // track count (which would multiply real Suno credit spend downstream).
  if (raw.length > expected) {
    console.warn(`[chain] D2 batch returned ${raw.length} tracks — capping to ${expected}`);
  } else if (raw.length < expected) {
    console.warn(`[chain] D2 batch returned ${raw.length} tracks, fewer than ${expected} — keeping all`);
  }
  const specs = raw.slice(0, expected);
  for (const s of specs) {
    if (!s.title || !s.style_tags || !s.structure) {
      throw new Error("D2 track spec missing title/style_tags/structure.");
    }
  }
  return specs;
}

async function appendTrackSpecs(episodeId: number, current: unknown, next: TrackSpec[]): Promise<TrackSpec[]> {
  const existing = Array.isArray(current) ? (current as TrackSpec[]) : [];
  const merged = [...existing, ...next];
  await updateDrEpisodeFields(episodeId, { trackSpecs: merged });
  return merged;
}

// ── Stage handlers ───────────────────────────────────────────────────────────

async function handleD0Done(job: DoneJob) {
  const episodeId = job.episodeId!;
  const scenes = extractJson<SceneInput[]>(job.result ?? "[]");
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("D0 output did not contain any scenes.");
  }
  // Pick the first candidate; D0 already avoids recent scenes via [RECENT_SCENES].
  const scene = scenes[0];
  await updateDrEpisodeFields(episodeId, { sceneInput: scene });
  await updateDrEpisodeStatus(episodeId, "d1_pending");
  await enqueueDrStage({
    promptKey: "D1",
    stage: "D1",
    vars: { SCENE_INPUT: formatSceneInput(scene) },
    episodeId,
    causedByJobId: job.id,
  });
}

async function handleD1Done(job: DoneJob) {
  const episodeId = job.episodeId!;
  const visual = extractJson<{
    scene_analysis?: string;
    image_prompt?: string;
    veo_prompt?: string;
    ambient_sound_map?: unknown;
    intro_text?: string;
  }>(job.result ?? "{}");

  const visualWithHarmonic = visual as typeof visual & { harmonic_palette?: unknown };
  const ambient = validateAmbient(visual.ambient_sound_map);
  const harmonic = parseHarmonicPalette(visualWithHarmonic.harmonic_palette);
  if (!harmonic) {
    throw new Error("D1 output missing/invalid harmonic_palette (key_center, mode, tempo_anchor_bpm 40–84).");
  }
  if (!visual.image_prompt || !visual.veo_prompt) {
    throw new Error("D1 output missing image_prompt/veo_prompt.");
  }

  await updateDrEpisodeFields(episodeId, {
    visualFoundation: {
      scene_analysis: visual.scene_analysis ?? "",
      image_prompt: visual.image_prompt,
      veo_prompt: visual.veo_prompt,
      intro_text: visual.intro_text ?? "",
    },
    ambientSoundMap: ambient,
    harmonicPalette: harmonic,
  });
  await updateDrEpisodeStatus(episodeId, "d2a_pending");

  const scene = (await getDrEpisode(episodeId))?.sceneInput as SceneInput | null;
  await enqueueDrStage({
    promptKey: "D2A",
    stage: "D2A",
    vars: {
      AMBIENT_SOUND_MAP: formatAmbientSoundMap(ambient),
      HARMONIC_PALETTE: formatHarmonicPalette(harmonic),
      SCENE_NAME: scene?.scene_name ?? "",
    },
    episodeId,
    causedByJobId: job.id,
  });
}

async function handleD2Batch(
  job: DoneJob,
  expected: number,
  nextStatus: "d2b_pending" | "d2c_pending",
  nextStage: "D2B" | "D2C",
) {
  const episodeId = job.episodeId!;
  const specs = parseTrackSpecs(job.result ?? "[]", expected);
  const episode = await getDrEpisode(episodeId);
  await appendTrackSpecs(episodeId, episode?.trackSpecs, specs);
  await updateDrEpisodeStatus(episodeId, nextStatus);

  const ambient = episode?.ambientSoundMap as AmbientSoundMap | null;
  const harmonic = episode?.harmonicPalette as HarmonicPalette | null;
  const scene = episode?.sceneInput as SceneInput | null;
  if (!ambient) throw new Error("D2 batch advance missing ambient_sound_map.");
  if (!harmonic) throw new Error("D2 batch advance missing harmonic_palette.");

  await enqueueDrStage({
    promptKey: nextStage,
    stage: nextStage,
    vars: {
      AMBIENT_SOUND_MAP: formatAmbientSoundMap(ambient),
      HARMONIC_PALETTE: formatHarmonicPalette(harmonic),
      SCENE_NAME: scene?.scene_name ?? "",
    },
    episodeId,
    causedByJobId: job.id,
  });
}

async function handleD2ADone(job: DoneJob) {
  await handleD2Batch(job, 5, "d2b_pending", "D2B");
}

async function handleD2BDone(job: DoneJob) {
  await handleD2Batch(job, 10, "d2c_pending", "D2C");
}

async function handleD2CDone(job: DoneJob) {
  const episodeId = job.episodeId!;
  const specs = parseTrackSpecs(job.result ?? "[]", 5);
  const episode = await getDrEpisode(episodeId);
  const allSpecs = await appendTrackSpecs(episodeId, episode?.trackSpecs, specs);

  // Initialize the Suno fan-out queue from the full spec list.
  const audio: EpisodeTrackAudio[] = allSpecs.map((s, i) => ({
    specIndex: i,
    title: s.title,
    role: s.role,
    taskId: null,
    status: "pending",
    clips: [],
  }));
  // Plus one dedicated ambience track (specIndex -1) the assembler loops under
  // the whole mix. Its Suno spec is code-built from the ambient sound map in suno.ts.
  const ambientBedAudio: EpisodeTrackAudio = {
    specIndex: -1,
    title: "Ambient Bed",
    role: "Ambient Bed",
    taskId: null,
    status: "pending",
    clips: [],
  };
  await updateDrEpisodeFields(episodeId, { audio, ambientBedAudio });
  await updateDrEpisodeStatus(episodeId, "suno_pending");
  // Suno fan-out runs server-side via runSunoForPendingEpisode() in this cycle.
}

async function handleD3Done(job: DoneJob) {
  const episodeId = job.episodeId!;
  const thumb = extractJson<{ strategy?: unknown; nano_banana_prompt?: string }>(job.result ?? "{}");
  if (!thumb.nano_banana_prompt) {
    throw new Error("D3 output missing nano_banana_prompt.");
  }
  await updateDrEpisodeFields(episodeId, { thumbnail: thumb });
  await updateDrEpisodeStatus(episodeId, "d4_pending");

  const episode = await getDrEpisode(episodeId);
  const ambient = episode?.ambientSoundMap as AmbientSoundMap | null;
  const scene = episode?.sceneInput as SceneInput | null;
  const audio = (episode?.audio as EpisodeTrackAudio[] | null) ?? [];
  if (!ambient || !scene) throw new Error("D3 advance missing scene/ambient.");

  const trackTitles = [...audio]
    .sort((a, b) => a.specIndex - b.specIndex)
    .map((t, i) => `${i + 1}. ${t.title}`)
    .join("\n");

  await enqueueDrStage({
    promptKey: "D4",
    stage: "D4",
    vars: {
      SCENE_NAME: scene.scene_name,
      AMBIENT_SOUND_MAP: formatAmbientSoundMap(ambient),
      TRACK_TITLES: trackTitles,
    },
    episodeId,
    causedByJobId: job.id,
  });
}

async function handleD4Done(job: DoneJob) {
  const episodeId = job.episodeId!;
  const variable = parseD4Variable(extractJson<unknown>(job.result ?? "{}"));

  const episode = await getDrEpisode(episodeId);
  const scene = episode?.sceneInput as SceneInput | null;
  const ambient = episode?.ambientSoundMap as AmbientSoundMap | null;
  const audio = (episode?.audio as EpisodeTrackAudio[] | null) ?? [];
  if (!scene || !ambient) throw new Error("D4 advance missing scene/ambient.");

  // Chapters must match the crossfaded final audio (each crossfade shrinks the
  // timeline by CROSSFADE_SEC), so use the same value the assembler will use.
  const crossfadeSec = Number(await getDrConfigValue(DR_CONFIG_KEYS.crossfadeSec)) || DEFAULT_CROSSFADE_SEC;
  const chapters: YouTubeChapter[] = buildChaptersFromAudio(audio, crossfadeSec);
  const description = buildDescription(variable, scene, ambient, chapters);

  await updateDrEpisodeFields(episodeId, {
    ytTitle: variable.best_title,
    ytSlug: variable.slug,
    ytDescription: description,
    ytTags: variable.hidden_tags,
    ytChapters: chapters as unknown as Record<string, unknown>[],
    ytPinnedComment: variable.pinned_comment,
    ytPlaylists: variable.playlists,
  });
  await updateDrEpisodeStatus(episodeId, "ready");

  const project = await ensureManualEpisodeProjectDirs({ id: episodeId, trackCount: audio.length });
  await notify(
    [
      `✅ Episode #${episodeId} ready for local assembly`,
      `Title: ${variable.best_title}`,
      `Project: <code>${project.projectName}</code>`,
      `Place your manual <code>intro.mp4</code> and <code>loop.mp4</code> in <code>${project.videoOutputDir}</code>`,
      `${audio.length} tracks → ${project.finalVideoPath}`,
    ].join("\n"),
  );
}

const STAGE_HANDLERS: Record<string, (job: DoneJob) => Promise<void>> = {
  D0: handleD0Done,
  D1: handleD1Done,
  D2A: handleD2ADone,
  D2B: handleD2BDone,
  D2C: handleD2CDone,
  D3: handleD3Done,
  D4: handleD4Done,
};

export async function runDrChainCycle(): Promise<DrChainCycleResult> {
  await setDrConfigValue(DR_CONFIG_KEYS.cronLastRunAt, new Date().toISOString()).catch(() => {});

  const paused = await getDrConfigValue(DR_CONFIG_KEYS.pipelinePaused).catch(() => null);
  if (paused === "true") {
    const localAssembly = await runLocalAssemblyWatcher();
    return { processed: 0, results: [], sunoRan: false, sunoWaiting: null, localAssembly, staleReset: 0 };
  }

  const staleReset = await resetStaleRunningDrJobs(15);
  if (staleReset > 0) {
    console.log(`[chain] Reset ${staleReset} stale running dr_jobs`);
  }

  const doneJobs = await listUnconsumedDoneDrJobs();
  const results: DrChainCycleResult["results"] = [];
  const justFailedJobIds = new Set<number>();

  for (const job of doneJobs) {
    const handler = STAGE_HANDLERS[job.stage];
    if (!handler) {
      await markDrJobConsumed(job.id);
      results.push({ jobId: job.id, stage: job.stage, ok: false, error: "Unknown stage" });
      continue;
    }

    try {
      await handler(job);
      await markDrJobConsumed(job.id);
      results.push({ jobId: job.id, stage: job.stage, ok: true });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[chain] Failed to handle dr_job #${job.id} stage=${job.stage}:`, error);
      await markDrJobHandlerFailed(job.id, error);
      justFailedJobIds.add(job.id);
      if (job.episodeId) {
        await updateDrEpisodeStatus(job.episodeId, "needs_attention").catch(() => {});
      }
      await notify(
        `🔴 Job #${job.id} (<b>${job.stage}</b>)${job.episodeId ? ` episode #${job.episodeId}` : ""} failed: ${error}`,
      ).catch(() => {});
      results.push({ jobId: job.id, stage: job.stage, ok: false, error });
    }
  }

  const failedJobs = await listUnconsumedFailedDrJobs();
  for (const job of failedJobs) {
    if (justFailedJobIds.has(job.id)) {
      await markDrJobConsumed(job.id);
      continue;
    }
    await notify(
      `🔴 Job #${job.id} (<b>${job.stage}</b>)${job.episodeId ? ` episode #${job.episodeId}` : ""} failed: ${job.errorMessage ?? "unknown error"}`,
    );
    await markDrJobConsumed(job.id);
    if (job.episodeId) {
      await updateDrEpisodeStatus(job.episodeId, "needs_attention");
    }
  }

  const sunoRan = await runSunoForPendingEpisode();
  const sunoWaiting = sunoRan ? null : await describePendingSunoWait();
  const localAssembly = await runLocalAssemblyWatcher();

  return {
    processed: doneJobs.length,
    results,
    sunoRan,
    sunoWaiting,
    localAssembly,
    staleReset,
  };
}
