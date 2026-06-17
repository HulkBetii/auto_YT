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

const PIPELINE_STEPS = ["S1", "S2", "TTS", "S3", "S4", "IMG", "ASSEMBLE"] as const;

const STATUS_DONE_STEPS: Record<string, number> = {
  s1_pending:        0,
  s2_pending:        1,
  tts_pending:       2,
  s3_pending:        3,
  s4_pending:        4,
  ready:             5,
  image_gen_pending: 5,
  assembly_pending:  6,
  assembly_done:     7,
  needs_attention:   -1,
};

const STATUS_RUNNING_STEP: Record<string, string | null> = {
  s1_pending:        "S1",
  s2_pending:        "S2",
  tts_pending:       "TTS",
  s3_pending:        "S3",
  s4_pending:        "S4",
  ready:             null,
  image_gen_pending: "IMG",
  assembly_pending:  "ASSEMBLE",
  assembly_done:     null,
  needs_attention:   null,
};

function progressPercent(current: number | null, expected: number | null) {
  return Math.min(100, Math.max(0, Math.round(((current ?? 0) / Math.max(1, expected ?? 1)) * 100)));
}

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
  const inPipelineCount = inFlightVideos.length;
  const assemblyDoneCount = countByStatus["assembly_done"] ?? 0;

  const statCards = [
    { label: "IN PIPELINE", value: inPipelineCount, tone: "text-[#007AFF]" },
    { label: "ASSEMBLED", value: assemblyDoneCount, tone: "text-[#34C759]" },
    { label: "JOBS DONE", value: jobsDoneCount, tone: "text-[#1C1C1E] dark:text-white" },
  ];

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
              Overview
            </h1>
            <span className="flex min-h-[24px] items-center gap-1.5 rounded-full bg-[#D1F2D1] px-2.5 py-0.5 text-[11px] font-medium text-[#1A7A1A] dark:bg-[#34C759]/15 dark:text-[#34C759]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34C759]" />
              Live
            </span>
          </div>
          <p className="mt-1 text-[15px] leading-relaxed text-[#6E6E73] dark:text-[#AEAEB2]">
            Production pipeline for Ancient Humans — scripts, audio, images, and assembly.
          </p>
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
              className="border-black/[.08] bg-white shadow-none rounded-xl transition-colors duration-150 dark:border-white/[.10] dark:bg-[#1C1C1E]"
            >
              <CardContent className="p-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                  {card.label}
                </p>
                <p className={`mt-1 text-[34px] font-semibold leading-none ${card.tone}`}>
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
          <Card className="border-black/[.08] bg-white shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
            <CardContent className="p-0 divide-y divide-black/[.06] dark:divide-white/[.08]">
              {inFlightVideos.map((v) => {
                const doneCount = STATUS_DONE_STEPS[v.status] ?? 0;
                const imageCount = v.imageCount ?? 0;
                const imageCountExpected = v.imageCountExpected ?? 0;
                const imageProgress = progressPercent(imageCount, imageCountExpected);
                const isGeneratingImages = imageCountExpected > 0 && imageCount < imageCountExpected;
                const runningStep = isGeneratingImages ? "IMG" : (STATUS_RUNNING_STEP[v.status] ?? null);
                const topic = v.chosenTopic as { title?: string } | null;
                const title = topic?.title ?? `Video #${v.id}`;
                return (
                  <div key={v.id} className="px-4 py-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-4">
                      <Link
                        href={`/videos/${v.id}`}
                        className="min-w-0 flex-1 truncate text-[15px] font-medium text-[#1C1C1E] hover:text-[#007AFF] dark:text-white transition-colors duration-150"
                      >
                        {title}
                      </Link>
                      <Badge className={`shrink-0 text-[11px] ${statusBadgeClass(v.status)}`}>
                        {VIDEO_STATUS_LABELS[v.status] ?? v.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-px">
                      {PIPELINE_STEPS.map((step, i) => {
                        const isDone = i < doneCount;
                        const isRunning = step === runningStep;
                        return (
                          <div key={step} className="flex items-center gap-px">
                            <div
                              className={[
                                "flex items-center justify-center rounded-md px-2 py-[2px] text-[10px] font-medium tracking-wide",
                                isRunning
                                  ? "bg-[#FF9F0A]/10 text-[#FF9F0A] animate-pulse ring-1 ring-inset ring-[#FF9F0A]/20"
                                  : isDone
                                    ? "bg-[#34C759]/10 text-[#34C759]"
                                    : "bg-[#E5E5EA] text-[#AEAEB2] dark:bg-white/[.05] dark:text-[#6E6E73]",
                              ].join(" ")}
                            >
                              {step}
                            </div>
                            {i < PIPELINE_STEPS.length - 1 && (
                              <div className={`h-px w-2 ${i < doneCount ? "bg-[#34C759]/30" : "bg-[#E5E5EA] dark:bg-white/[.08]"}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {imageCountExpected > 0 && (
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#E5E5EA] dark:bg-white/[.10]">
                          <div
                            className="h-1.5 rounded-full bg-[#007AFF] transition-all duration-150"
                            style={{ width: `${imageProgress}%` }}
                          />
                        </div>
                        <span className="shrink-0 text-[12px] font-medium text-[#6E6E73] dark:text-[#AEAEB2]">
                          IMG {imageCount}/{imageCountExpected} · {imageProgress}%
                        </span>
                      </div>
                    )}
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
          <Card className="border-black/[.08] bg-white shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
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
