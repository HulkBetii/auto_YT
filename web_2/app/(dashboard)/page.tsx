import Link from "next/link";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { ahVideos, ahJobs } from "@/lib/db/schema";
import { listInPipelineAhVideos } from "@/lib/db/repo/videos";
import { statusBadgeClass, VIDEO_STATUS_LABELS, formatRelative } from "@/lib/ui/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RunPipelineButton } from "./RunPipelineButton";
import { CreateVideoButton } from "./CreateVideoButton";
import { PipelineServices } from "./PipelineServices";

export const dynamic = "force-dynamic";

const PIPELINE_STEPS = ["S1", "S2", "TTS", "S3", "S4"] as const;

const STATUS_DONE_STEPS: Record<string, number> = {
  s1_pending: 0,
  s2_pending: 1,
  tts_pending: 2,
  s3_pending: 3,
  s4_pending: 4,
  ready: 5,
  needs_attention: -1,
};

const STATUS_RUNNING_STEP: Record<string, string | null> = {
  s1_pending: "S1",
  s2_pending: "S2",
  tts_pending: "TTS",
  s3_pending: "S3",
  s4_pending: "S4",
  ready: null,
  needs_attention: null,
};

export default async function DashboardPage() {
  const [videoCounts, jobsDoneCount, inFlightVideos, recentJobs] = await Promise.all([
    db.select({ status: ahVideos.status, count: sql<number>`count(*)::int` })
      .from(ahVideos)
      .groupBy(ahVideos.status),
    db.select({ n: sql<number>`count(*)::int` })
      .from(ahJobs)
      .where(sql`${ahJobs.status} = 'done'`)
      .then((r) => r[0]?.n ?? 0),
    listInPipelineAhVideos(),
    db.select({ id: ahJobs.id, stage: ahJobs.stage, videoId: ahJobs.videoId, status: ahJobs.status, finishedAt: ahJobs.finishedAt })
      .from(ahJobs)
      .where(sql`${ahJobs.status} = 'done'`)
      .orderBy(sql`${ahJobs.finishedAt} DESC NULLS LAST`)
      .limit(10),
  ]);

  const countByStatus = Object.fromEntries(videoCounts.map((r) => [r.status, r.count]));
  const readyCount = countByStatus["ready"] ?? 0;
  const inPipelineCount = inFlightVideos.length;

  const statCards = [
    { label: "READY", value: readyCount },
    { label: "IN PIPELINE", value: inPipelineCount },
    { label: "JOBS DONE", value: jobsDoneCount },
  ];

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
            Overview
          </h1>
          <span className="flex items-center gap-1.5 rounded-full bg-[#D1F2D1] px-2.5 py-0.5 text-[11px] font-medium text-[#1A7A1A]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34C759]" />
            Live
          </span>
        </div>
        <div className="flex items-center gap-3">
          <CreateVideoButton />
          <RunPipelineButton />
        </div>
      </div>

      {/* Pipeline services health */}
      <PipelineServices />

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
            IN PIPELINE — {inFlightVideos.length} video{inFlightVideos.length !== 1 ? "s" : ""}
          </p>
          <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
            <CardContent className="p-0 divide-y divide-black/[.06] dark:divide-white/[.08]">
              {inFlightVideos.map((v) => {
                const doneCount = STATUS_DONE_STEPS[v.status] ?? 0;
                const runningStep = STATUS_RUNNING_STEP[v.status] ?? null;
                const topic = v.chosenTopic as { title?: string } | null;
                const title = topic?.title ?? `Video #${v.id}`;
                return (
                  <div key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
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
                    <Link
                      href={`/videos/${v.id}`}
                      className="min-w-0 flex-1 truncate text-[15px] text-[#1C1C1E] hover:text-[#007AFF] dark:text-white transition-colors duration-150"
                    >
                      {title}
                    </Link>
                    <Badge className={`shrink-0 text-[11px] ${statusBadgeClass(v.status)}`}>
                      {VIDEO_STATUS_LABELS[v.status] ?? v.status}
                    </Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Recent completed jobs */}
      {recentJobs.length > 0 && (
        <section>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
            RECENT ACTIVITY
          </p>
          <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
            <CardContent className="p-0 divide-y divide-black/[.06] dark:divide-white/[.08]">
              {recentJobs.map((j) => (
                <div key={j.id} className="flex items-center gap-3 px-4 py-3">
                  <Badge className="shrink-0 font-mono text-[11px] bg-[#E5E5EA] text-[#3C3C43] border-0 dark:bg-white/[.10] dark:text-[#AEAEB2]">
                    {j.stage}
                  </Badge>
                  {j.videoId && (
                    <Link
                      href={`/videos/${j.videoId}`}
                      className="min-w-0 flex-1 truncate text-[15px] text-[#1C1C1E] transition-colors duration-150 hover:text-[#007AFF] dark:text-white"
                    >
                      Video #{j.videoId}
                    </Link>
                  )}
                  <span className="shrink-0 text-[13px] text-[#AEAEB2]">
                    {formatRelative(j.finishedAt)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </>
  );
}
