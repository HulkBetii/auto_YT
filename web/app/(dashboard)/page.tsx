import Link from "next/link";
import { desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { jobs, videoContent, videos } from "@/lib/db/schema";
import { formatDuration, formatRelative } from "@/lib/ui/format";
import { buildTTSStatusChecker } from "@/lib/pipeline/ttsVoiceMap";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RunPipelineButton } from "./RunPipelineButton";
import { WorkerControl } from "./WorkerControl";

export const dynamic = "force-dynamic";

async function getVideoStatusCounts() {
  return db
    .select({ status: videos.status, count: sql<number>`count(*)::int` })
    .from(videos)
    .groupBy(videos.status);
}

async function getJobStatusCounts() {
  return db
    .select({ status: jobs.status, count: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status);
}

async function getAvgStageDuration() {
  return db
    .select({
      stage: jobs.stage,
      avgSeconds: sql<number>`avg(extract(epoch from (${jobs.finishedAt} - ${jobs.startedAt})))::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(jobs)
    .where(isNotNull(jobs.finishedAt))
    .groupBy(jobs.stage);
}

async function getRecentActivity() {
  return db
    .select({
      id: videoContent.id,
      videoId: videoContent.videoId,
      stage: videoContent.stage,
      createdAt: videoContent.createdAt,
      videoTitle: videos.title,
    })
    .from(videoContent)
    .leftJoin(videos, eq(videoContent.videoId, videos.id))
    .orderBy(desc(videoContent.createdAt))
    .limit(12);
}

// Pipeline statuses + ready_to_publish (TTS pending) — filtered in JS below
const IN_FLIGHT_STATUSES = ["topic", "outline", "scripted", "seo_done", "scoring", "needs_retry", "ready_to_publish"] as const;

// Stage order for the mini-stepper (P1→P2→P3→P4→Score→TTS)
const PIPELINE_STEPS = ["P1", "P2", "P3", "P4", "Score", "TTS"] as const;
type PipelineStep = (typeof PIPELINE_STEPS)[number];

/** Map video status → how many steps are "done" (green) */
const STATUS_DONE_STEPS: Record<string, number> = {
  topic: 1,              // P1 done
  outline: 2,            // P1+P2 done
  scripted: 3,           // P1+P2+P3 done
  seo_done: 4,           // P1+P2+P3+P4 done
  scoring: 4,            // same as seo_done, Score is "running"
  needs_retry: 2,        // back to P3
  ready_to_publish: 5,   // Score done, TTS pending/running
};

/** Map video status → which step is currently "running" (pulse) */
const STATUS_RUNNING_STEP: Record<string, PipelineStep | null> = {
  topic: "P2",
  outline: "P3",
  scripted: "P4",
  seo_done: "Score",
  scoring: "Score",
  needs_retry: "P3",
  ready_to_publish: "TTS",
};

async function getInFlightVideos() {
  const inFlight = await db
    .select({ id: videos.id, title: videos.title, featuredPerson: videos.featuredPerson, status: videos.status, audioUrl: videos.audioUrl })
    .from(videos)
    .where(inArray(videos.status, [...IN_FLIGHT_STATUSES]))
    .orderBy(videos.id);

  // For ready_to_publish: only show if TTS not yet done (audio_url IS NULL)
  const filtered = inFlight.filter(
    (v) => v.status !== "ready_to_publish" || v.audioUrl === null,
  );

  if (filtered.length === 0) return [];

  // Get the latest pending/running job for each in-flight video
  const videoIds = filtered.map((v) => v.id);
  const runningJobs = await db
    .select({ videoId: jobs.videoId, stage: jobs.stage, status: jobs.status })
    .from(jobs)
    .where(
      sql`${jobs.videoId} = ANY(ARRAY[${sql.join(videoIds.map((id) => sql`${id}`), sql`, `)}]::int[])
        AND ${jobs.status} IN ('pending', 'running')`,
    )
    .orderBy(desc(jobs.id));

  // Keep only the latest job per video
  const latestJobByVideo = new Map<number, { stage: string; status: string }>();
  for (const j of runningJobs) {
    if (j.videoId != null && !latestJobByVideo.has(j.videoId)) {
      latestJobByVideo.set(j.videoId, { stage: j.stage, status: j.status });
    }
  }

  return filtered.map((v) => ({
    ...v,
    runningJob: latestJobByVideo.get(v.id) ?? null,
  }));
}

async function getTTSRows() {
  return db
    .select({ featuredPerson: videos.featuredPerson, audioUrl: videos.audioUrl })
    .from(videos)
    .where(sql`${videos.status} in ('ready_to_publish', 'published', 'analyzed')`);
}

export default async function DashboardPage() {
  const [videoCounts, jobCounts, avgDurations, recentActivity, ttsRows, ttsStatusFn, inFlightVideos] =
    await Promise.all([
      getVideoStatusCounts(),
      getJobStatusCounts(),
      getAvgStageDuration(),
      getRecentActivity(),
      getTTSRows(),
      buildTTSStatusChecker(),
      getInFlightVideos(),
    ]);

  const ttsStats = ttsRows.reduce(
    (acc, r) => {
      const s = ttsStatusFn(r.featuredPerson, r.audioUrl);
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const readyCount = videoCounts.find((r) => r.status === "ready_to_publish")?.count ?? 0;
  const jobsDoneCount = jobCounts.find((r) => r.status === "done")?.count ?? 0;
  const audioCount = ttsStats["done"] ?? 0;

  const statCards = [
    { label: "READY TO PUBLISH", value: readyCount },
    { label: "AUDIO DONE", value: audioCount },
    { label: "JOBS DONE", value: jobsDoneCount },
  ];

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
            Tổng quan
          </h1>
          <span className="flex items-center gap-1.5 rounded-full bg-[#D1F2D1] px-2.5 py-0.5 text-[11px] font-medium text-[#1A7A1A]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34C759]" />
            Live
          </span>
        </div>
        <div className="flex items-center gap-3">
          <WorkerControl />
          <RunPipelineButton />
        </div>
      </div>

      {/* Stat cards */}
      <section>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
          PIPELINE STATUS
        </p>
        <div className="grid grid-cols-3 gap-4">
          {statCards.map((card) => (
            <Card
              key={card.label}
              className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]"
            >
              <CardContent className="p-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                  {card.label}
                </p>
                <p className="mt-1 text-[34px] font-semibold leading-none text-[#1C1C1E] dark:text-white">
                  {card.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* In-flight pipeline */}
      {inFlightVideos.length > 0 && (
        <section>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
            ĐANG XỬ LÝ — {inFlightVideos.length} video
          </p>
          <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
            <CardContent className="p-0 divide-y divide-black/[.06] dark:divide-white/[.08]">
              {inFlightVideos.map((v) => {
                const doneCount = STATUS_DONE_STEPS[v.status] ?? 0;
                const runningStep = STATUS_RUNNING_STEP[v.status] ?? null;
                return (
                  <div key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    {/* Mini stepper */}
                    <div className="flex items-center gap-1 shrink-0">
                      {PIPELINE_STEPS.map((step, i) => {
                        const isDone = i < doneCount;
                        const isRunning = step === runningStep;
                        return (
                          <div key={step} className="flex items-center gap-1">
                            <div
                              className={[
                                "flex items-center justify-center rounded-full text-[10px] font-medium",
                                isRunning
                                  ? "h-6 px-2 bg-[#FF9F0A] text-white animate-pulse"
                                  : isDone
                                    ? "h-6 px-2 bg-[#34C759] text-white"
                                    : "h-6 px-2 bg-[#E5E5EA] text-[#AEAEB2] dark:bg-white/[.08] dark:text-[#6E6E73]",
                              ].join(" ")}
                            >
                              {step}
                            </div>
                            {i < PIPELINE_STEPS.length - 1 && (
                              <div className={`h-px w-3 ${i < doneCount ? "bg-[#34C759]" : "bg-[#E5E5EA] dark:bg-white/[.08]"}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Title + person */}
                    <Link
                      href={`/videos/${v.id}`}
                      className="min-w-0 flex-1 truncate text-[15px] text-[#1C1C1E] hover:text-[#007AFF] dark:text-white transition-colors duration-150"
                    >
                      {v.title ?? `Video #${v.id}`}
                    </Link>

                    {/* Running job badge */}
                    {v.runningJob && (
                      <Badge
                        className={[
                          "shrink-0 font-mono text-[11px] border-0",
                          v.runningJob.status === "running"
                            ? "bg-[#FFF3D1] text-[#FF9F0A]"
                            : "bg-[#E5E5EA] text-[#3C3C43] dark:bg-white/[.10] dark:text-[#AEAEB2]",
                        ].join(" ")}
                      >
                        {v.runningJob.status === "running" ? "running" : "pending"} {v.runningJob.stage}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Two-column: processing time + activity */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
            PROCESSING TIME
          </p>
          <div className="overflow-hidden rounded-xl border border-black/[.08] bg-white dark:border-white/[.10] dark:bg-[#1C1C1E]">
            <Table>
              <TableHeader>
                <TableRow className="border-black/[.06] hover:bg-transparent dark:border-white/[.08]">
                  <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                    Stage
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                    Avg
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                    Samples
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {avgDurations.map((row) => (
                  <TableRow
                    key={row.stage}
                    className="border-black/[.06] hover:bg-black/[.02] dark:border-white/[.08] dark:hover:bg-white/[.03]"
                  >
                    <TableCell className="text-[15px] font-medium text-[#1C1C1E] dark:text-white">
                      {row.stage}
                    </TableCell>
                    <TableCell className="text-[15px] text-[#6E6E73]">
                      {formatDuration(row.avgSeconds)}
                    </TableCell>
                    <TableCell className="text-[15px] text-[#6E6E73]">{row.count}</TableCell>
                  </TableRow>
                ))}
                {avgDurations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-[15px] text-[#AEAEB2]">
                      Chưa có dữ liệu.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <section>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
            RECENT ACTIVITY
          </p>
          <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
            <CardContent className="p-0 divide-y divide-black/[.06] dark:divide-white/[.08]">
              {recentActivity.map((row) => (
                <div key={row.id} className="flex items-center gap-3 px-4 py-3">
                  <Badge className="shrink-0 font-mono text-[12px] bg-[#E5E5EA] text-[#3C3C43] border-0 dark:bg-white/[.10] dark:text-[#AEAEB2]">
                    {row.stage}
                  </Badge>
                  <Link
                    href={`/videos/${row.videoId}`}
                    className="min-w-0 flex-1 truncate text-[15px] text-[#1C1C1E] transition-colors duration-150 hover:text-[#007AFF] dark:text-white"
                  >
                    {row.videoTitle ?? `Video #${row.videoId}`}
                  </Link>
                  <span className="shrink-0 text-[13px] text-[#AEAEB2]">
                    {formatRelative(row.createdAt)}
                  </span>
                </div>
              ))}
              {recentActivity.length === 0 && (
                <p className="px-4 py-8 text-center text-[15px] text-[#AEAEB2]">
                  Chưa có hoạt động nào.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}
