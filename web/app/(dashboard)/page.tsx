import Link from "next/link";
import { desc, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { jobs, videoContent, videos } from "@/lib/db/schema";
import { formatDuration, formatRelative } from "@/lib/ui/format";
import { buildTTSStatusChecker } from "@/lib/pipeline/ttsVoiceMap";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RunPipelineButton } from "./RunPipelineButton";

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

async function getTTSRows() {
  return db
    .select({ featuredPerson: videos.featuredPerson, audioUrl: videos.audioUrl })
    .from(videos)
    .where(sql`${videos.status} in ('ready_to_publish', 'published', 'analyzed')`);
}

export default async function DashboardPage() {
  const [videoCounts, jobCounts, avgDurations, recentActivity, ttsRows, ttsStatusFn] =
    await Promise.all([
      getVideoStatusCounts(),
      getJobStatusCounts(),
      getAvgStageDuration(),
      getRecentActivity(),
      getTTSRows(),
      buildTTSStatusChecker(),
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
        <RunPipelineButton />
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
