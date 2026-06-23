import Link from "next/link";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { drEpisodes, drJobs, STATUS_STEP, STATUS_ACTIVE_STEP, type SceneInput } from "@/lib/db/schema";
import { listInPipelineDrEpisodes } from "@/lib/db/repo/episodes";
import { statusBadgeClass, VIDEO_STATUS_LABELS, formatRelative } from "@/lib/ui/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RunPipelineButton } from "./RunPipelineButton";
import { CreateVideoButton } from "./CreateVideoButton";
import { PipelineServices } from "./PipelineServices";

export const dynamic = "force-dynamic";

const PIPELINE_STEPS = ["VISUAL", "AUDIO", "MUSIC", "THUMB", "PACKAGE", "IMG", "ASSEMBLE"] as const;

function episodeTitle(ep: { ytTitle: string | null; sceneInput: unknown; id: number }): string {
  if (ep.ytTitle) return ep.ytTitle;
  const scene = ep.sceneInput as SceneInput | null;
  return scene?.scene_name ?? `Episode #${ep.id}`;
}

export default async function DashboardPage() {
  const [episodeCounts, jobsDoneCount, inFlightEpisodes, recentJobs] = await Promise.all([
    db.select({ status: drEpisodes.status, count: sql<number>`count(*)::int` })
      .from(drEpisodes)
      .groupBy(drEpisodes.status),
    db.select({ n: sql<number>`count(*)::int` })
      .from(drJobs)
      .where(sql`${drJobs.status} = 'done'`)
      .then((r) => r[0]?.n ?? 0),
    listInPipelineDrEpisodes(),
    db.select({ id: drJobs.id, stage: drJobs.stage, episodeId: drJobs.episodeId, status: drJobs.status, finishedAt: drJobs.finishedAt })
      .from(drJobs)
      .where(sql`${drJobs.status} = 'done'`)
      .orderBy(sql`${drJobs.finishedAt} DESC NULLS LAST`)
      .limit(10),
  ]);

  const countByStatus = Object.fromEntries(episodeCounts.map((r) => [r.status, r.count]));
  const inPipelineCount = inFlightEpisodes.length;
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
            Drifter 2077 — Cyberpunk Noir Dark Jazz pixel ambience pipeline.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CreateVideoButton />
          <RunPipelineButton />
        </div>
      </div>

      <PipelineServices />

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

      {inFlightEpisodes.length > 0 && (
        <section>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
            IN PIPELINE — {inFlightEpisodes.length} episode{inFlightEpisodes.length !== 1 ? "s" : ""}
          </p>
          <Card className="border-black/[.08] bg-white shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
            <CardContent className="p-0 divide-y divide-black/[.06] dark:divide-white/[.08]">
              {inFlightEpisodes.map((ep) => {
                const doneCount = STATUS_STEP[ep.status] ?? 0;
                const activeStep = STATUS_ACTIVE_STEP[ep.status] ?? -1;
                return (
                  <div key={ep.id} className="px-4 py-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-4">
                      <Link
                        href={`/videos/${ep.id}`}
                        className="min-w-0 flex-1 truncate text-[15px] font-medium text-[#1C1C1E] hover:text-[#007AFF] dark:text-white transition-colors duration-150"
                      >
                        {episodeTitle(ep)}
                      </Link>
                      <Badge className={`shrink-0 text-[11px] ${statusBadgeClass(ep.status)}`}>
                        {VIDEO_STATUS_LABELS[ep.status] ?? ep.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-px">
                      {PIPELINE_STEPS.map((step, i) => {
                        const isDone = i < doneCount;
                        const isRunning = i === activeStep;
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
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}

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
                  {j.episodeId && (
                    <Link
                      href={`/videos/${j.episodeId}`}
                      className="min-w-0 flex-1 truncate text-[15px] text-[#1C1C1E] transition-colors duration-150 hover:text-[#007AFF] dark:text-white"
                    >
                      Episode #{j.episodeId}
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
