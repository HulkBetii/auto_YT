import { inArray } from "drizzle-orm";

import { db } from "../db";
import { getConfigValue } from "../db/repo/channel-config";
import { listRecentVideos } from "../db/repo/videos";
import { jobs, videos } from "../db/schema";
import { enqueueStage } from "./createJob";

/** Anything that hasn't reached a terminal state yet — a batch is still "in flight". */
const IN_FLIGHT_VIDEO_STATUSES = ["topic", "outline", "scripted", "seo_done", "scoring", "needs_retry"] as const;

function formatRecentVideos(rows: Awaited<ReturnType<typeof listRecentVideos>>): string {
  if (rows.length === 0) return "(まだ公開済みの動画はありません)";
  return rows
    .map((v) => `- ${v.title}（人物: ${v.featuredPerson ?? "?"} / Pain: ${v.painType ?? "?"} / 状態: ${v.status}）`)
    .join("\n");
}

export interface NewBatchResult {
  triggered: boolean;
  reason?: string;
  jobId?: number;
}

/**
 * Kicks off a new P1 (topic-generation) batch — the one piece of the pipeline
 * nothing else creates on its own. Every other stage is *chained* forward by
 * processDoneJob (lib/pipeline/chain.ts), but that chain has to start
 * somewhere: this is it.
 *
 * Guarded by an "is a batch already in flight?" check (any video not yet at a
 * terminal status, or any unconsumed/non-failed job) so overlapping batches
 * never pile up — the channel produces videos in batches, not a constant
 * stream, and starting a second P1 batch while the first is still mid-pipeline
 * would both waste prompt-credits and confuse anti-duplication (which scopes
 * to "recent videos", not "videos from completed batches").
 *
 * Extracted out of /api/cron/generate-topics (which runs weekly per
 * vercel.json — "0 0 * * 1") so the dashboard's "Chạy pipeline ngay" button
 * (/api/jobs/process-now) can ALSO try to start a fresh batch on demand:
 * when nothing is in flight, the operator can manually kick off the next
 * 5-video batch right away instead of waiting up to a week for the cron.
 * Single source of truth, shared by both entry points.
 */
export async function maybeStartNewBatch(): Promise<NewBatchResult> {
  if ((await getConfigValue("new_batch_paused")) === "true") {
    return { triggered: false, reason: "new_batch_paused is true — set it to false in channel_config to resume" };
  }

  const inFlightVideos = await db
    .select({ id: videos.id })
    .from(videos)
    .where(inArray(videos.status, [...IN_FLIGHT_VIDEO_STATUSES]))
    .limit(1);
  if (inFlightVideos.length > 0) {
    return { triggered: false, reason: "a batch is already in flight (videos not yet ready_to_publish/published)" };
  }

  const inFlightJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(inArray(jobs.status, ["pending", "running"]))
    .limit(1);
  if (inFlightJobs.length > 0) {
    return { triggered: false, reason: "a job is already pending/running" };
  }

  const recent = await listRecentVideos(15);
  const job = await enqueueStage({
    promptKey: "P1",
    stage: "P1",
    vars: { RECENT_VIDEOS: formatRecentVideos(recent) },
  });

  return { triggered: true, jobId: job.id };
}
