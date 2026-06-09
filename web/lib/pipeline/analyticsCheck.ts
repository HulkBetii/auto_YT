/**
 * Shared analytics refresh + P5/P6 trigger logic.
 * Called by both /api/cron/check-analytics (scheduled) and
 * /api/jobs/process-now (manual dashboard button).
 */
import { and, asc, desc, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db";
import { getConfigValue } from "@/lib/db/repo/channel-config";
import { hasActiveJobForVideoStage, hasActivePendingStageJob } from "@/lib/db/repo/jobs";
import { getLatestAnalytics, saveAnalyticsSnapshot } from "@/lib/db/repo/video-analytics";
import { listVideosByStatus } from "@/lib/db/repo/videos";
import { promptVersions, videos } from "@/lib/db/schema";
import { enqueueStage } from "@/lib/pipeline/createJob";
import { formatBatchTable, type BatchRow } from "@/lib/pipeline/chain";
import { fetchVideoStatistics } from "@/lib/youtube/client";

const ANALYTICS_REFRESH_HOURS = 24;
const ANALYSIS_DELAY_HOURS = 48;

async function configInt(key: string, fallback: number): Promise<number> {
  const raw = await getConfigValue(key);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hoursSince(date: Date | null | undefined): number {
  if (!date) return Number.POSITIVE_INFINITY;
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

export async function refreshAnalyticsAndTriggerP5(): Promise<number[]> {
  const minViews = await configInt("rollback_min_views", 100);
  const published = await listVideosByStatus("published");
  const triggered: number[] = [];

  for (const video of published) {
    if (!video.youtubeVideoId || !video.publishedAt) continue;
    if (hoursSince(video.publishedAt) < ANALYSIS_DELAY_HOURS) continue;

    const latest = await getLatestAnalytics(video.id);
    if (hoursSince(latest?.fetchedAt) >= ANALYTICS_REFRESH_HOURS) {
      try {
        const stats = await fetchVideoStatistics(video.youtubeVideoId);
        if (stats) {
          await saveAnalyticsSnapshot({
            videoId: video.id,
            views: stats.views,
            likes: stats.likes,
            comments: stats.comments,
            // Carry forward manually-entered CTR/AVD so this snapshot doesn't blank them out.
            ctrBasisPoints: latest?.ctrBasisPoints ?? null,
            averageViewDurationSeconds: latest?.averageViewDurationSeconds ?? null,
          });
        }
      } catch (err) {
        console.error(`[analytics] Failed to fetch YouTube stats for video #${video.id}:`, err);
      }
    }

    const analytics = await getLatestAnalytics(video.id);
    if (!analytics) continue;
    if (analytics.views < minViews) continue;
    if (analytics.ctrBasisPoints == null || analytics.averageViewDurationSeconds == null) continue;
    if (await hasActiveJobForVideoStage(video.id, "P5")) continue;

    await enqueueStage({
      promptKey: "P5",
      stage: "P5",
      videoId: video.id,
      vars: {
        VIDEO_TITLE: video.title,
        PATTERN_USED: video.titlePattern ?? "",
        TEMP: String(video.temperature ?? ""),
        PAIN_TYPE: video.painType ?? "",
        PERSON: video.featuredPerson ?? "",
        LENGTH: "",
        CTR: (analytics.ctrBasisPoints / 100).toFixed(2),
        AVD: (analytics.averageViewDurationSeconds / 60).toFixed(0),
        COMMENT_RATE:
          analytics.comments != null ? ((analytics.comments / analytics.views) * 100).toFixed(2) : "",
        LIKE_RATE:
          analytics.likes != null ? ((analytics.likes / analytics.views) * 100).toFixed(2) : "",
        DROP_TIME: "",
        DROP_SEC: "",
        SOURCE_1: "",
        SOURCE_2: "",
        SOURCE_3: "",
      },
    });
    triggered.push(video.id);
  }

  return triggered;
}

export async function triggerP6IfBatchReady(): Promise<number[] | null> {
  const batchSize = await configInt("p6_batch_size", 10);

  const [activeP1] = await db
    .select({ effectiveFromVideoId: promptVersions.effectiveFromVideoId })
    .from(promptVersions)
    .where(eq(promptVersions.promptKey, "P1"))
    .orderBy(desc(promptVersions.version))
    .limit(1);
  const anchorId = activeP1?.effectiveFromVideoId ?? 0;

  const analyzed = await db
    .select()
    .from(videos)
    .where(and(eq(videos.status, "analyzed"), gt(videos.id, anchorId)))
    .orderBy(asc(videos.id))
    .limit(batchSize);

  if (analyzed.length < batchSize) return null;
  if (await hasActivePendingStageJob("P6")) return null;

  const rows: BatchRow[] = [];
  for (let i = 0; i < analyzed.length; i++) {
    const video = analyzed[i];
    const analytics = await getLatestAnalytics(video.id);
    rows.push({
      no: i + 1,
      title: video.title,
      pattern: video.titlePattern ?? "",
      pain: video.painType ?? "",
      temp: String(video.temperature ?? ""),
      person: video.featuredPerson ?? "",
      lengthMin: "",
      ctrPct:
        analytics?.ctrBasisPoints != null ? (analytics.ctrBasisPoints / 100).toFixed(2) : "",
      avdPct:
        analytics?.averageViewDurationSeconds != null
          ? (analytics.averageViewDurationSeconds / 60).toFixed(0)
          : "",
      commentPct:
        analytics?.comments != null && analytics.views > 0
          ? ((analytics.comments / analytics.views) * 100).toFixed(2)
          : "",
      likePct:
        analytics?.likes != null && analytics.views > 0
          ? ((analytics.likes / analytics.views) * 100).toFixed(2)
          : "",
    });
  }

  await enqueueStage({
    promptKey: "P6",
    stage: "P6",
    vars: { VIDEO_BATCH_DATA: formatBatchTable(rows) },
    metadata: { batchVideoIds: analyzed.map((v) => v.id) },
  });

  return analyzed.map((v) => v.id);
}
