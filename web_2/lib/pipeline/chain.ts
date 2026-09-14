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
  updateAhVideoFields,
  updateAhVideoStatus,
} from "@/lib/db/repo/videos";
import { extractJson } from "@/lib/utils/json";
import { notify } from "@/lib/notifications";
import { getManualImageProjectInfo } from "@/lib/manual-image-project";
import { channelConfig } from "@/lib/config/channel";
import {
  buildDescription,
  computeChapterTimestamps,
  fmtChapterTime,
  normalizeUrlSlug,
  normalizeVideoSpecificTags,
  parseS4Variable,
  parseWhisperSegments,
} from "./descriptionBuilder";
import { enqueueAhStage } from "./createJob";
import { parseS1Selection, selectS1Topic } from "./rank";
import { describePendingTtsWait, runTTSAndWhisperForPendingVideo, smartBucketTranscript } from "./tts";
import { formatImagePrompts, formatThumbnailConcept } from "./visualStyle";
import { runBgmForPendingVideos } from "./bgm";
import { getAhConfigValue, setAhConfigValue } from "@/lib/db/repo/channel-config";

interface YouTubeChapter {
  time: string;
  title: string;
}

export interface AhChainCycleResult {
  processed: number;
  results: Array<{ jobId: number; stage: string; ok: boolean; error?: string }>;
  ttsRan: boolean;
  ttsWaiting: string | null;
  staleReset: number;
}

export async function handleS1Done(job: Awaited<ReturnType<typeof listUnconsumedDoneAhJobs>>[number]) {
  const videoId = job.videoId!;
  const selection = parseS1Selection(job.result ?? "[]");
  const chosenTopic = selectS1Topic(selection);

  await updateAhVideoFields(videoId, {
    topicCandidates: selection.candidates as unknown as Record<string, unknown>[],
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

const LEADING_CHATGPT_UI_ARTIFACTS = new Set(["edit", "copy", "share"]);

export function sanitizeS2ScriptOutput(raw: string): string {
  let script = raw.replace(/^\uFEFF/, "").trim();
  const lines = script.split(/\r?\n/);

  while (
    lines.length > 1 &&
    LEADING_CHATGPT_UI_ARTIFACTS.has(lines[0].trim().toLowerCase())
  ) {
    lines.shift();
    while (lines.length > 0 && lines[0].trim() === "") {
      lines.shift();
    }
  }

  script = lines.join("\n").trim();
  return script;
}

export async function handleS2Done(job: Awaited<ReturnType<typeof listUnconsumedDoneAhJobs>>[number]) {
  const videoId = job.videoId!;
  const script = sanitizeS2ScriptOutput(job.result ?? "");

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


async function handleS3Done(job: Awaited<ReturnType<typeof listUnconsumedDoneAhJobs>>[number]) {
  const videoId = job.videoId!;
  const imagePrompts = formatImagePrompts((job.result ?? "").trim());

  await updateAhVideoFields(videoId, { imagePrompts });
  await updateAhVideoStatus(videoId, "s4_pending");

  // Read current video for topic title + script excerpt
  const video = await getAhVideo(videoId);
  const topic = video?.chosenTopic as { title?: string; head_keyword?: string } | null;
  const scriptExcerpt = (video?.script ?? "").slice(0, 600);

  await enqueueAhStage({
    promptKey: "S4",
    stage: "S4",
    vars: {
      TOPIC_TITLE: topic?.title ?? "",
      HEAD_KEYWORD: topic?.head_keyword ?? topic?.title?.toLowerCase() ?? "",
      SCRIPT_EXCERPT: scriptExcerpt,
    },
    videoId,
    causedByJobId: job.id,
  });
}

async function handleS4Done(job: Awaited<ReturnType<typeof listUnconsumedDoneAhJobs>>[number]) {
  const videoId = job.videoId!;

  // S4 only generates the variable copy; chapters/description/links are
  // assembled in code below from real Whisper timestamps + channelConfig,
  // so the LLM can't hallucinate timing or boilerplate.
  const variable = parseS4Variable(extractJson<unknown>(job.result ?? "{}"));

  const video = await getAhVideo(videoId);
  const segments = parseWhisperSegments(video?.whisperTranscript);
  const chapterTimes = computeChapterTimestamps(segments, variable.chapter_titles.length);
  const chapterCount = Math.min(variable.chapter_titles.length, chapterTimes.length);
  const chapters: YouTubeChapter[] = Array.from({ length: chapterCount }, (_, i) => ({
    time: fmtChapterTime(chapterTimes[i]),
    title: variable.chapter_titles[i],
  }));
  const description = buildDescription(variable, chapterTimes, channelConfig);
  const urlSlug = normalizeUrlSlug(variable.url_slug, variable.title);
  const videoSpecificTags = normalizeVideoSpecificTags(variable.tags);
  const thumbnail = {
    ...variable.thumbnail,
    concept: formatThumbnailConcept(variable.thumbnail.concept),
  };

  await updateAhVideoFields(videoId, {
    ytTitle: variable.title,
    ytUrlSlug: urlSlug,
    ytDescription: description,
    ytTags: videoSpecificTags,
    ytChapters: chapters as unknown as Record<string, unknown>[],
    ytThumbnail: thumbnail as unknown as Record<string, unknown>,
  });
  await updateAhVideoStatus(videoId, "ready");

  const manualProject = getManualImageProjectInfo({
    id: videoId,
    imagePrompts: video?.imagePrompts,
  });
  await notify(
    [
      `âœ… Video #${videoId} ready for manual images`,
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

  // Pause guard â€” toggled from the dashboard
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
        `ðŸ”´ Job #${job.id} (<b>${job.stage}</b>)${job.videoId ? ` video #${job.videoId}` : ""} failed: ${error}`,
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
      `ðŸ”´ Job #${job.id} (<b>${job.stage}</b>)${job.videoId ? ` video #${job.videoId}` : ""} failed: ${job.errorMessage ?? "unknown error"}`,
    );
    await markAhJobConsumed(job.id);
    if (job.videoId) {
      await updateAhVideoStatus(job.videoId, "needs_attention");
    }
  }

  // Run TTS+Whisper server-side for any tts_pending video
  const ttsRan = await runTTSAndWhisperForPendingVideo();
  const ttsWaiting = ttsRan ? null : await describePendingTtsWait();
  await runBgmForPendingVideos().catch((err) => {
    console.warn("[bgm] cycle failed without blocking video pipeline:", err);
  });

  return {
    processed: doneJobs.length,
    results,
    ttsRan,
    ttsWaiting,
    staleReset,
  };
}




