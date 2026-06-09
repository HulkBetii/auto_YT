import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";

import { db } from "@/lib/db";
import { jobs, videoAnalytics, videoContent } from "@/lib/db/schema";
import { formatDateTime, scoreColorClass } from "@/lib/ui/format";
import { getVideo } from "@/lib/db/repo/videos";
import { buildTTSStatusChecker } from "@/lib/pipeline/ttsVoiceMap";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { YoutubeIdInline } from "./YoutubeIdInline";
import { AnalyticsForm } from "./AnalyticsForm";
import { PipelineTimeline } from "./PipelineTimeline";
import { AudioCard, AudioCardPending, AudioCardNoMapping } from "./AudioCard";

export const dynamic = "force-dynamic";

export default async function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const videoId = Number.parseInt(id, 10);
  if (!Number.isFinite(videoId)) notFound();

  const video = await getVideo(videoId);
  if (!video) notFound();

  const [content, videoJobs, analytics, ttsStatusFn] = await Promise.all([
    db.select().from(videoContent).where(eq(videoContent.videoId, videoId)).orderBy(videoContent.createdAt),
    db.select().from(jobs).where(eq(jobs.videoId, videoId)).orderBy(jobs.createdAt),
    db.select().from(videoAnalytics).where(eq(videoAnalytics.videoId, videoId)).orderBy(videoAnalytics.fetchedAt),
    buildTTSStatusChecker(),
  ]);

  const ttsStatus = ttsStatusFn(video.featuredPerson, video.audioUrl);
  const latestAnalytics = analytics.at(-1);
  const showAnalyticsForm = video.status === "published" || video.status === "analyzed";
  const showAudio = video.status === "ready_to_publish" || video.status === "published" || video.status === "analyzed";

  const metaRows: { label: string; value: React.ReactNode }[] = [
    { label: "Nhân vật", value: video.featuredPerson ?? "—" },
    { label: "Loại nỗi đau", value: video.painType ?? "—" },
    { label: "Nhiệt độ", value: video.temperature ?? "—" },
    {
      label: "Điểm",
      value: (
        <div>
          <span className={`text-[15px] font-medium ${scoreColorClass(video.score)}`}>
            {video.score != null ? `${video.score} / 100` : "—"}
          </span>
          {video.score != null && (
            <Progress
              value={video.score}
              className="mt-1.5 h-[3px] rounded-full [&>div]:bg-[#007AFF]"
            />
          )}
        </div>
      ),
    },
    { label: "Thử lại", value: video.retryCount },
    {
      label: "YouTube ID",
      value: (
        <YoutubeIdInline videoId={video.id} currentValue={video.youtubeVideoId} />
      ),
    },
  ];

  return (
    <>
      {/* Back link */}
      <div>
        <Link
          href="/videos"
          className="inline-flex items-center gap-1 text-[15px] text-[#007AFF] transition-colors duration-150 hover:text-[#0062CC]"
        >
          <ChevronLeft className="h-4 w-4" />
          Tất cả video
        </Link>
      </div>

      {/* Main 2-column layout */}
      <div className="md:grid md:grid-cols-[280px_1fr] gap-6 items-start">

        {/* LEFT — Metadata card */}
        <Card className="sticky top-[68px] border-black/[.08] shadow-none rounded-xl overflow-hidden dark:border-white/[.10] dark:bg-[#1C1C1E]">
          <CardContent className="p-0">
            {/* Title + status */}
            <div className="px-5 pt-5 pb-4">
              <p className="text-[17px] font-semibold text-[#1C1C1E] dark:text-white leading-snug">
                {video.title}
              </p>
              <div className="mt-2">
                <StatusBadge status={video.status} />
              </div>
            </div>

            <Separator className="bg-black/[.06] dark:bg-white/[.08]" />

            {/* Meta rows */}
            <div className="divide-y divide-black/[.06] dark:divide-white/[.08]">
              {metaRows.map((row) => (
                <div key={row.label} className="flex items-center gap-3 min-h-[44px] px-4 py-3">
                  <span className="w-24 shrink-0 text-[13px] text-[#6E6E73]">{row.label}</span>
                  <div className="flex-1 text-[15px] text-[#1C1C1E] dark:text-white">{row.value}</div>
                </div>
              ))}
            </div>

            {/* Analytics form */}
            {showAnalyticsForm && (
              <>
                <Separator className="bg-black/[.06] dark:bg-white/[.08]" />
                <div className="p-4">
                  <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                    CTR &amp; AVD
                  </p>
                  <AnalyticsForm
                    videoId={video.id}
                    currentCtrPct={latestAnalytics?.ctrBasisPoints != null ? latestAnalytics.ctrBasisPoints / 100 : null}
                    currentAvdMinutes={latestAnalytics?.averageViewDurationSeconds != null ? latestAnalytics.averageViewDurationSeconds / 60 : null}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* RIGHT — Timeline + audio */}
        <div className="flex flex-col gap-6 min-w-0">
          {/* Pipeline timeline */}
          <section>
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
              PIPELINE TIMELINE
            </p>
            <PipelineTimeline content={content} jobs={videoJobs} />
          </section>

          {/* Jobs table */}
          <section>
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
              JOBS
            </p>
            <div className="overflow-hidden rounded-xl border border-black/[.08] bg-white dark:border-white/[.10] dark:bg-[#1C1C1E]">
              <Table>
                <TableHeader>
                  <TableRow className="border-black/[.06] hover:bg-transparent dark:border-white/[.08]">
                    {["Stage", "Status", "Retries", "Duration", "Error", "Created"].map((h) => (
                      <TableHead key={h} className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {videoJobs.map((job) => {
                    const durationSec =
                      job.startedAt && job.finishedAt
                        ? (job.finishedAt.getTime() - job.startedAt.getTime()) / 1000
                        : null;
                    const durationStr =
                      durationSec != null
                        ? durationSec < 60
                          ? `${Math.round(durationSec)}s`
                          : `${(durationSec / 60).toFixed(1)}m`
                        : "—";
                    return (
                      <TableRow key={job.id} className="border-black/[.06] hover:bg-black/[.02] dark:border-white/[.08] dark:hover:bg-white/[.03]">
                        <TableCell className="text-[15px] font-medium text-[#1C1C1E] dark:text-white">
                          {job.stage}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={job.status} />
                        </TableCell>
                        <TableCell className="text-[15px] text-[#6E6E73]">{job.retryCount}</TableCell>
                        <TableCell className="text-[15px] text-[#6E6E73]">{durationStr}</TableCell>
                        <TableCell className="max-w-[180px] truncate text-[13px] text-[#FF3B30]">
                          {job.errorMessage ?? "—"}
                        </TableCell>
                        <TableCell className="text-[13px] text-[#6E6E73]">
                          {formatDateTime(job.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {videoJobs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-[15px] text-[#AEAEB2]">
                        Chưa có job nào.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>

          {/* Analytics snapshots */}
          {analytics.length > 0 && (
            <section>
              <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                ANALYTICS SNAPSHOTS
              </p>
              <div className="overflow-hidden rounded-xl border border-black/[.08] bg-white dark:border-white/[.10] dark:bg-[#1C1C1E]">
                <Table>
                  <TableHeader>
                    <TableRow className="border-black/[.06] hover:bg-transparent dark:border-white/[.08]">
                      {["Fetched", "Views", "Likes", "Comments", "CTR", "AVD"].map((h) => (
                        <TableHead key={h} className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                          {h}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.map((row) => (
                      <TableRow key={row.id} className="border-black/[.06] hover:bg-black/[.02] dark:border-white/[.08]">
                        <TableCell className="text-[13px] text-[#6E6E73]">{formatDateTime(row.fetchedAt)}</TableCell>
                        <TableCell className="text-[15px] text-[#1C1C1E] dark:text-white">{row.views}</TableCell>
                        <TableCell className="text-[15px] text-[#6E6E73]">{row.likes ?? "—"}</TableCell>
                        <TableCell className="text-[15px] text-[#6E6E73]">{row.comments ?? "—"}</TableCell>
                        <TableCell className="text-[15px] text-[#6E6E73]">
                          {row.ctrBasisPoints != null ? `${(row.ctrBasisPoints / 100).toFixed(2)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-[15px] text-[#6E6E73]">
                          {row.averageViewDurationSeconds != null
                            ? `${(row.averageViewDurationSeconds / 60).toFixed(1)}m`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          {/* Audio section */}
          {showAudio && (
            <section>
              {ttsStatus === "done" && video.audioUrl ? (
                <AudioCard
                  src={video.audioUrl}
                  character={video.featuredPerson}
                  title={video.title}
                />
              ) : ttsStatus === "pending" ? (
                <AudioCardPending />
              ) : ttsStatus === "no_mapping" ? (
                <AudioCardNoMapping featuredPerson={video.featuredPerson} />
              ) : null}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
