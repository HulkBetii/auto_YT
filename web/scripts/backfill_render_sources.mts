import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { eq, isNotNull } from "drizzle-orm";

config({ path: ".env.local" });

const { db } = await import("../lib/db/index.js");
const { videos } = await import("../lib/db/schema/index.js");
const { getLatestVideoContent } = await import(
  "../lib/db/repo/video-content.js"
);
const { parseP3ForTTS } = await import("../lib/pipeline/tts.js");
const {
  getRenderDirectory,
  getRenderedVideoPath,
  renderedVideoExists,
} = await import("../lib/render/files.js");
const {
  buildRenderQueueReset,
  MAX_RENDER_ATTEMPTS,
} = await import("../lib/render/state.js");

const MAX_PLAUSIBLE_RENDER_DURATION_MS = 6 * 60 * 60 * 1000;

function getExistingAudioPath(videoId: number) {
  return path.join(getRenderDirectory(videoId), "audio.mp3");
}

async function calculateExistingSourceHash(
  videoId: number,
  ttsText: string,
): Promise<string | null> {
  try {
    const audio = await readFile(getExistingAudioPath(videoId));
    return createHash("sha256")
      .update(audio)
      .update(Buffer.from([0]))
      .update(ttsText, "utf8")
      .digest("hex");
  } catch {
    return null;
  }
}

const audioVideos = await db
  .select()
  .from(videos)
  .where(isNotNull(videos.audioUrl))
  .orderBy(videos.id);

let queued = 0;
let preserved = 0;
let failed = 0;

for (const video of audioVideos) {
  const p3 = await getLatestVideoContent(video.id, "P3");
  const ttsText = p3 ? parseP3ForTTS(p3.output) : "";
  if (!ttsText) {
    await db
      .update(videos)
      .set({
        renderStatus: "failed",
        renderError: p3
          ? "P3 parsed to empty TTS text during render source backfill"
          : "No P3 content found during render source backfill",
        renderAttemptCount: MAX_RENDER_ATTEMPTS,
        renderNextAttemptAt: null,
        renderRequestedAt: video.renderRequestedAt ?? video.createdAt,
        renderStartedAt: null,
        renderFinishedAt: new Date(),
        renderHeartbeatAt: null,
        renderWorkerToken: null,
      })
      .where(eq(videos.id, video.id));
    console.log(`FAILED #${video.id}: missing usable P3 source`);
    failed += 1;
    continue;
  }

  const outputAvailable = await renderedVideoExists(video.id);
  if (video.renderStatus === "done" && outputAvailable) {
    const videoPath = getRenderedVideoPath(video.id);
    const outputStats = await stat(videoPath);
    const audioStats = await stat(getExistingAudioPath(video.id)).catch(
      () => outputStats,
    );
    const existingStartIsPlausible =
      video.renderStartedAt !== null &&
      Math.abs(outputStats.mtime.getTime() - video.renderStartedAt.getTime()) <=
        MAX_PLAUSIBLE_RENDER_DURATION_MS;
    const renderStartedAt: Date = existingStartIsPlausible
      ? video.renderStartedAt!
      : audioStats.mtime;
    const existingRequestIsPlausible =
      video.renderRequestedAt !== null &&
      video.renderRequestedAt <= outputStats.mtime &&
      renderStartedAt.getTime() - video.renderRequestedAt.getTime() <=
        MAX_PLAUSIBLE_RENDER_DURATION_MS;
    const renderRequestedAt = existingRequestIsPlausible
      ? video.renderRequestedAt
      : audioStats.mtime;
    const sourceHash =
      video.renderSourceHash ??
      (await calculateExistingSourceHash(video.id, ttsText));
    await db
      .update(videos)
      .set({
        ttsText,
        videoPath,
        renderStatus: "done",
        renderError: null,
        renderAttemptCount: Math.max(video.renderAttemptCount, 1),
        renderNextAttemptAt: null,
        renderRequestedAt,
        renderStartedAt,
        renderFinishedAt: video.renderFinishedAt ?? outputStats.mtime,
        renderHeartbeatAt: video.renderHeartbeatAt ?? outputStats.mtime,
        renderWorkerToken: null,
        renderedAudioUrl: video.renderedAudioUrl ?? video.audioUrl,
        renderSourceHash: sourceHash,
      })
      .where(eq(videos.id, video.id));
    console.log(`PRESERVED #${video.id}: existing MP4 kept`);
    preserved += 1;
    continue;
  }

  await db
    .update(videos)
    .set({
      ttsText,
      ...buildRenderQueueReset(),
    })
    .where(eq(videos.id, video.id));
  console.log(`QUEUED #${video.id}`);
  queued += 1;
}

console.log(
  `Render source backfill complete: queued=${queued}, preserved=${preserved}, failed=${failed}`,
);
