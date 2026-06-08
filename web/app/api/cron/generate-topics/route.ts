import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { listRecentVideos } from "@/lib/db/repo/videos";
import { jobs, videos } from "@/lib/db/schema";
import { enqueueStage } from "@/lib/pipeline/createJob";

export const maxDuration = 60;

function requireAuth(request: Request): NextResponse | null {
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected) return null;
  const provided = request.headers.get("authorization");
  if (provided !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Anything that hasn't reached a terminal state yet — a batch is still "in flight". */
const IN_FLIGHT_VIDEO_STATUSES = ["topic", "outline", "scripted", "seo_done", "scoring", "needs_retry"] as const;

function formatRecentVideos(rows: Awaited<ReturnType<typeof listRecentVideos>>): string {
  if (rows.length === 0) return "(まだ公開済みの動画はありません)";
  return rows
    .map((v) => `- ${v.title}（人物: ${v.featuredPerson ?? "?"} / Pain: ${v.painType ?? "?"} / 状態: ${v.status}）`)
    .join("\n");
}

/**
 * Kicks off a new P1 (topic-generation) batch — the one piece of the pipeline
 * nothing else creates on its own. Every other stage is *chained* forward by
 * processDoneJob (lib/pipeline/chain.ts), but that chain has to start
 * somewhere: this is it.
 *
 * Guarded by an "is a batch already in flight?" check (any video not yet at a
 * terminal status, or any unconsumed/non-failed P1 job) so overlapping batches
 * never pile up — the channel produces videos in batches, not a constant
 * stream, and starting a second P1 batch while the first is still mid-pipeline
 * would both waste prompt-credits and confuse anti-duplication (which scopes
 * to "recent videos", not "videos from completed batches").
 */
async function maybeGenerateNewBatch() {
  const inFlightVideos = await db
    .select({ id: videos.id })
    .from(videos)
    .where(inArray(videos.status, [...IN_FLIGHT_VIDEO_STATUSES]))
    .limit(1);
  if (inFlightVideos.length > 0) {
    return { triggered: false, reason: "a batch is already in flight (videos not yet ready_to_publish/published)" };
  }

  const inFlightP1Jobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(inArray(jobs.status, ["pending", "running"]))
    .limit(1);
  if (inFlightP1Jobs.length > 0) {
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

export async function GET(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  const result = await maybeGenerateNewBatch();
  return NextResponse.json({ ok: true, ...result });
}
