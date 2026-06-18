import {
  hasOpenAhJobForVideoStage,
  listUnconsumedDoneAhJobs,
  listUnconsumedFailedAhJobs,
  markAhJobConsumed,
  markAhJobHandlerFailed,
  resetStaleRunningAhJobs,
} from "@/lib/db/repo/jobs";
import {
  getAhVideo,
  listAhVideos,
  listRecentAhTopicSummaries,
  updateAhVideoFields,
  updateAhVideoStatus,
} from "@/lib/db/repo/videos";
import { extractJson } from "@/lib/utils/json";
import { notify } from "@/lib/notifications";
import { getManualImageProjectInfo } from "@/lib/manual-image-project";
import { enqueueAhStage } from "./createJob";
import { rankTopics, type AhTopic } from "./rank";
import { describePendingTtsWait, runTTSAndWhisperForPendingVideo, smartBucketTranscript } from "./tts";
import { getAhConfigValue, setAhConfigValue } from "@/lib/db/repo/channel-config";

export interface AhChainCycleResult {
  processed: number;
  results: Array<{ jobId: number; stage: string; ok: boolean; error?: string }>;
  ttsRan: boolean;
  ttsWaiting: string | null;
  staleReset: number;
}

async function handleS1Done(job: Awaited<ReturnType<typeof listUnconsumedDoneAhJobs>>[number]) {
  const videoId = job.videoId!;
  const candidates = extractJson<AhTopic[]>(job.result ?? "[]");
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("S1 output did not contain any topic candidates.");
  }

  const recentTopics = await listRecentAhTopicSummaries(30, videoId);
  const chosenTopic = await rankTopics(candidates, recentTopics);

  await updateAhVideoFields(videoId, {
    topicCandidates: candidates as unknown as Record<string, unknown>[],
    chosenTopic: chosenTopic as unknown as Record<string, unknown>,
  });
  await updateAhVideoStatus(videoId, "s2_pending");

  await enqueueAhStage({
    promptKey: "S2",
    stage: "S2",
    vars: {
      TOPIC_TITLE: chosenTopic.title,
      TOPIC_ANGLE: chosenTopic.angle,
      HOOK: chosenTopic.hook,
      KEY_QUESTIONS: chosenTopic.key_questions.join("\n"),
    },
    videoId,
    causedByJobId: job.id,
  });
}

async function handleS2Done(job: Awaited<ReturnType<typeof listUnconsumedDoneAhJobs>>[number]) {
  const videoId = job.videoId!;
  const script = (job.result ?? "").trim();

  // Derive a slug from the first line of the script (the opening hook)
  const firstLine = script.split("\n").find((l) => l.trim()) ?? "";
  const scriptSlug = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60);

  await updateAhVideoFields(videoId, { script, scriptSlug });
  await updateAhVideoStatus(videoId, "tts_pending");
  // TTS+Whisper runs server-side via runTTSAndWhisperForPendingVideo() in the same cycle
}

const DOODLE_STYLE_PREFIX =
  "Hand-drawn 2D doodle cartoon animation, flat solid colors, bold black hand-drawn outlines, slightly wobbly imperfect marker lines,";

const DOODLE_STYLE_LOCK =
  "no visible text, no captions, no labels, no numbers, no timestamp overlays, no written words, no hashtags, no hex color codes, no gradients, no drop shadows, no photographic textures, no photorealism, no 3D render, no realistic faces, no anime, wide horizontal composition, simple educational YouTube explainer doodle style.";
const LEGACY_DOODLE_STYLE_LOCK =
  "no gradients, no drop shadows, no photographic textures, no photorealism, no 3D render, no realistic faces, no anime, wide horizontal composition, simple educational YouTube explainer doodle style.";

const TIMESTAMP_TOKEN_RE = /\[\d{1,2}:\d{2}(?::\d{2})?\]/g;
const HASH_TOKEN_RE = /#[\p{L}\p{N}_-]+/gu;
const QUOTED_TEXT_RE =
  /\b(?:bold\s+)?(?:red|black|white|blue|orange|green|yellow|cream|gray|grey)?\s*(?:hand[- ]lettered\s+)?text\s+[“"][^”"]+[”"]/giu;
const LABEL_TEXT_RE = /\b(?:label(?:ed|led)?|caption(?:ed)?)\s+[“"][^”"]+[”"]/giu;

function sanitizeImagePromptDescription(text: string): string {
  return text
    .replaceAll(DOODLE_STYLE_PREFIX, "")
    .replaceAll(DOODLE_STYLE_LOCK, "")
    .replaceAll(LEGACY_DOODLE_STYLE_LOCK, "")
    .replace(TIMESTAMP_TOKEN_RE, "")
    .replace(HASH_TOKEN_RE, "")
    .replace(QUOTED_TEXT_RE, "simple symbolic doodle concept")
    .replace(LABEL_TEXT_RE, "marked with a simple icon")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[,.;:\s]+/, "")
    .replace(/[.,]?\s*$/, "")
    .trim();
}

export function formatImagePrompts(raw: string): string {
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const desc = sanitizeImagePromptDescription(line);
      return `${DOODLE_STYLE_PREFIX} ${desc}, ${DOODLE_STYLE_LOCK}`;
    })
    .join("\n");
}

async function handleS3Done(job: Awaited<ReturnType<typeof listUnconsumedDoneAhJobs>>[number]) {
  const videoId = job.videoId!;
  const imagePrompts = formatImagePrompts((job.result ?? "").trim());

  await updateAhVideoFields(videoId, { imagePrompts });
  await updateAhVideoStatus(videoId, "s4_pending");

  // Read current video for topic title + script excerpt
  const video = await getAhVideo(videoId);
  const topic = video?.chosenTopic as { title?: string } | null;
  const scriptExcerpt = (video?.script ?? "").slice(0, 600);

  await enqueueAhStage({
    promptKey: "S4",
    stage: "S4",
    vars: {
      TOPIC_TITLE: topic?.title ?? "",
      SCRIPT_EXCERPT: scriptExcerpt,
    },
    videoId,
    causedByJobId: job.id,
  });
}

async function handleS4Done(job: Awaited<ReturnType<typeof listUnconsumedDoneAhJobs>>[number]) {
  const videoId = job.videoId!;

  const meta = extractJson<{ title?: string; description?: string; tags?: string }>(
    job.result ?? "{}",
  );

  await updateAhVideoFields(videoId, {
    ytTitle: meta.title ?? "",
    ytDescription: meta.description ?? "",
    ytTags: meta.tags ?? "",
  });
  await updateAhVideoStatus(videoId, "ready");

  const video = await getAhVideo(videoId);
  const manualProject = getManualImageProjectInfo({
    id: videoId,
    imagePrompts: video?.imagePrompts,
  });
  await notify(
    [
      `✅ Video #${videoId} ready for manual images`,
      `Project: <code>${manualProject.projectName}</code>`,
      `Folder: <code>${manualProject.imageOutputDir}</code>`,
      `Prompts: ${manualProject.promptCount}`,
      "Create images in that exact folder.",
    ].join("\n"),
  );
}

const STAGE_HANDLERS: Record<
  string,
  (job: Awaited<ReturnType<typeof listUnconsumedDoneAhJobs>>[number]) => Promise<void>
> = {
  S1: handleS1Done,
  S2: handleS2Done,
  S3: handleS3Done,
  S4: handleS4Done,
};

async function repairMissingS3Jobs(): Promise<number> {
  const videos = await listAhVideos({ status: "s3_pending" }, 20);
  let repaired = 0;

  for (const video of videos) {
    if (!video.whisperTranscript) continue;
    if (await hasOpenAhJobForVideoStage(video.id, "S3")) continue;

    const topic = video.chosenTopic as { title?: string } | null;
    await enqueueAhStage({
      promptKey: "S3",
      stage: "S3",
      vars: {
        TIMESTAMPED_SCRIPT: smartBucketTranscript(video.whisperTranscript),
        TOPIC_TITLE: topic?.title ?? "",
      },
      videoId: video.id,
      metadata: { repair: "missing_s3_job" },
    });
    repaired++;
  }

  return repaired;
}

export async function runAhChainCycle(): Promise<AhChainCycleResult> {
  // Record cron heartbeat
  await setAhConfigValue("cron_last_run_at", new Date().toISOString()).catch(() => {});

  // Pause guard — toggled from the dashboard
  const paused = await getAhConfigValue("pipeline_paused").catch(() => null);
  if (paused === "true") {
    return { processed: 0, results: [], ttsRan: false, ttsWaiting: null, staleReset: 0 };
  }

  const staleReset = await resetStaleRunningAhJobs(15);
  if (staleReset > 0) {
    console.log(`[chain] Reset ${staleReset} stale running ah_jobs`);
  }
  const s3Repaired = await repairMissingS3Jobs();
  if (s3Repaired > 0) {
    console.log(`[chain] Repaired ${s3Repaired} missing S3 job(s)`);
  }

  const doneJobs = await listUnconsumedDoneAhJobs();
  const results: AhChainCycleResult["results"] = [];
  // Track jobs we just failed so the failed-job loop below doesn't double-notify them.
  const justFailedJobIds = new Set<number>();

  for (const job of doneJobs) {
    const handler = STAGE_HANDLERS[job.stage];
    if (!handler) {
      await markAhJobConsumed(job.id);
      results.push({ jobId: job.id, stage: job.stage, ok: false, error: "Unknown stage" });
      continue;
    }

    try {
      await handler(job);
      await markAhJobConsumed(job.id);
      results.push({ jobId: job.id, stage: job.stage, ok: true });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[chain] Failed to handle ah_job #${job.id} stage=${job.stage}:`, error);
      await markAhJobHandlerFailed(job.id, error);
      justFailedJobIds.add(job.id);
      // Mark video needs_attention so it surfaces on the dashboard instead of staying
      // stuck in a pipeline status with no active job to advance it.
      if (job.videoId) {
        await updateAhVideoStatus(job.videoId, "needs_attention").catch(() => {});
      }
      await notify(
        `🔴 Job #${job.id} (<b>${job.stage}</b>)${job.videoId ? ` video #${job.videoId}` : ""} failed: ${error}`,
      ).catch(() => {});
      results.push({ jobId: job.id, stage: job.stage, ok: false, error });
    }
  }

  // Notify and consume failed jobs (from LLM worker, not handler failures handled above).
  const failedJobs = await listUnconsumedFailedAhJobs();
  for (const job of failedJobs) {
    // Skip jobs we already notified about in this cycle to prevent duplicate alerts.
    if (justFailedJobIds.has(job.id)) {
      await markAhJobConsumed(job.id);
      continue;
    }
    await notify(
      `🔴 Job #${job.id} (<b>${job.stage}</b>)${job.videoId ? ` video #${job.videoId}` : ""} failed: ${job.errorMessage ?? "unknown error"}`,
    );
    await markAhJobConsumed(job.id);
    if (job.videoId) {
      await updateAhVideoStatus(job.videoId, "needs_attention");
    }
  }

  // Run TTS+Whisper server-side for any tts_pending video
  const ttsRan = await runTTSAndWhisperForPendingVideo();
  const ttsWaiting = ttsRan ? null : await describePendingTtsWait();

  return {
    processed: doneJobs.length,
    results,
    ttsRan,
    ttsWaiting,
    staleReset,
  };
}
