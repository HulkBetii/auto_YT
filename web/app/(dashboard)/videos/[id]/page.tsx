import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { jobs, videoAnalytics, videoContent } from "@/lib/db/schema";
import { formatDateTime, scoreColorClass } from "@/lib/ui/format";
import { formatAdaptiveLabel, formatListCount } from "@/lib/ui/adaptive";
import {
  formatPersonaName,
  getPersonaStatusLabel,
  getPersonaUiStatus,
} from "@/lib/ui/fixedPersona";
import { getVideo } from "@/lib/db/repo/videos";
import { buildTTSStatusChecker } from "@/lib/pipeline/ttsVoiceMap";
import {
  readResolvedChapterLines,
  renderedSubtitleExists,
  renderedVideoExists,
} from "@/lib/render/files";
import { StatusBadge } from "@/components/StatusBadge";
import { TtsStatusBadge } from "@/components/TtsStatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { YoutubeIdInline } from "./YoutubeIdInline";
import { AnalyticsForm } from "./AnalyticsForm";
import { PipelineTimeline } from "./PipelineTimeline";
import { AudioCard, AudioCardPending, AudioCardNoMapping } from "./AudioCard";
import { RenderPanel } from "./RenderPanel";
export const dynamic = "force-dynamic";
export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const videoId = Number.parseInt(id, 10);
  if (!Number.isFinite(videoId)) notFound();
  const video = await getVideo(videoId);
  if (!video) notFound();
  const [
    content,
    videoJobs,
    analytics,
    ttsStatusFn,
    outputAvailable,
    subtitleAvailable,
    chapterText,
  ] = await Promise.all([
    db
      .select()
      .from(videoContent)
      .where(eq(videoContent.videoId, videoId))
      .orderBy(videoContent.createdAt),
    db
      .select()
      .from(jobs)
      .where(eq(jobs.videoId, videoId))
      .orderBy(jobs.createdAt),
    db
      .select()
      .from(videoAnalytics)
      .where(eq(videoAnalytics.videoId, videoId))
      .orderBy(videoAnalytics.fetchedAt),
    buildTTSStatusChecker(),
    renderedVideoExists(videoId),
    renderedSubtitleExists(videoId),
    readResolvedChapterLines(videoId),
  ]);
  const ttsStatus = ttsStatusFn({
    featuredPerson: video.featuredPerson,
    audioUrl: video.audioUrl,
    ttsTaskId: video.ttsTaskId,
    ttsSubmittedAt: video.ttsSubmittedAt,
  });
  const personaStatus = getPersonaUiStatus(video.featuredPerson);
  const personaMeta = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span>{formatPersonaName(video.featuredPerson)}</span>
      {personaStatus !== "missing" && (
        <span
          title={
            personaStatus === "fixed"
              ? "Backend fixed persona"
              : "Legacy video created before fixed persona strategy"
          }
          className={[
            "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase",
            personaStatus === "fixed"
              ? "bg-[var(--success-soft)] text-[var(--success)]"
              : "bg-[var(--warning-soft)] text-[var(--warning)]",
          ].join(" ")}
        >
          {getPersonaStatusLabel(personaStatus)}
        </span>
      )}
    </div>
  );
  const latestAnalytics = analytics.at(-1);
  const showAnalyticsForm =
    video.status === "published" || video.status === "analyzed";
  const showAudio =
    video.status === "ready_to_publish" ||
    video.status === "published" ||
    video.status === "analyzed";
  const metaRows: { label: string; value: React.ReactNode }[] = [
    { label: "Channel persona", value: personaMeta },
    { label: "Persona mode", value: formatAdaptiveLabel(video.personaMode) },
    { label: "Archetype", value: formatAdaptiveLabel(video.contentArchetype) },
    { label: "Hook", value: formatAdaptiveLabel(video.hookType) },
    { label: "Comment", value: formatAdaptiveLabel(video.commentMode) },
    { label: "List count", value: formatListCount(video.listCount) },
    { label: "Core promise", value: video.corePromise ?? "—" },
    { label: "Title family", value: video.titlePattern ?? "—" },
    { label: "Pain type", value: video.painType ?? "—" },
    { label: "Temperature", value: video.temperature ?? "—" },
    { label: "Book", value: video.referenceBook ?? "—" },
    {
      label: "Score",
      value: (
        <div>
          <span
            className={`text-[15px] font-medium ${scoreColorClass(video.score)}`}
          >
            {video.score != null ? `${video.score} / 100` : "—"}
          </span>
          {video.score != null && (
            <Progress
              value={video.score}
              className="mt-1.5 h-[3px] rounded-full [&>div]:bg-[var(--accent-cyan)]"
            />
          )}
        </div>
      ),
    },
    { label: "Retries", value: video.retryCount },
    {
      label: "YouTube ID",
      value: (
        <YoutubeIdInline
          videoId={video.id}
          currentValue={video.youtubeVideoId}
        />
      ),
    },
  ];
  return (
    <>
      {/* Back link */}
      <div>
        <Link
          href="/videos"
          className="inline-flex items-center gap-1 text-[15px] text-[var(--accent-cyan)] transition-colors duration-150 hover:text-[var(--accent-cyan-hover)]"
        >
          <ChevronLeft className="h-4 w-4" /> Tất cả video
        </Link>
      </div>
      {/* Main 2-column layout */}
      <div className="md:grid md:grid-cols-[280px_1fr] gap-6 items-start">
        {/* LEFT — Metadata card */}
        <Card className="sticky top-[68px] border-[var(--border-subtle)] shadow-none rounded-xl overflow-hidden ">
          <CardContent className="p-0">
            {/* Title + status */}
            <div className="px-5 pt-5 pb-4">
              <p className="text-[17px] font-semibold text-[var(--text-primary)] leading-snug">
                {video.title}
              </p>
              <div className="mt-2">
                <StatusBadge status={video.status} />
              </div>
            </div>
            <Separator className="bg-[var(--border-subtle)] " />
            {/* Meta rows */}
            <div className="divide-y divide-[var(--border-subtle)] ">
              {metaRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center gap-3 min-h-[44px] px-4 py-3"
                >
                  <span className="w-24 shrink-0 text-[13px] text-[var(--text-muted)]">
                    {row.label}
                  </span>
                  <div className="min-w-0 flex-1 break-words text-[15px] text-[var(--text-primary)] ">
                    {row.value}
                  </div>
                </div>
              ))}
            </div>
            {/* Analytics form */}
            {showAnalyticsForm && (
              <>
                <Separator className="bg-[var(--border-subtle)] " />
                <div className="p-4">
                  <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                    CTR &amp; AVD
                  </p>
                  <AnalyticsForm
                    videoId={video.id}
                    currentCtrPct={
                      latestAnalytics?.ctrBasisPoints != null
                        ? latestAnalytics.ctrBasisPoints / 100
                        : null
                    }
                    currentAvdMinutes={
                      latestAnalytics?.averageViewDurationSeconds != null
                        ? latestAnalytics.averageViewDurationSeconds / 60
                        : null
                    }
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
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
              PIPELINE TIMELINE
            </p>
            <PipelineTimeline content={content} jobs={videoJobs} />
          </section>
          {/* Jobs table */}
          <section>
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
              JOBS
            </p>
            <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] ">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow className="border-[var(--border-subtle)] hover:bg-transparent ">
                    {[
                      "Stage",
                      "Status",
                      "Retries",
                      "Duration",
                      "Error",
                      "Created",
                    ].map((h) => (
                      <TableHead
                        key={h}
                        className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]"
                      >
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {videoJobs.map((job) => {
                    const durationSec =
                      job.startedAt && job.finishedAt
                        ? (job.finishedAt.getTime() - job.startedAt.getTime()) /
                          1000
                        : null;
                    const durationStr =
                      durationSec != null
                        ? durationSec < 60
                          ? `${Math.round(durationSec)}s`
                          : `${(durationSec / 60).toFixed(1)}m`
                        : "—";
                    return (
                      <TableRow
                        key={job.id}
                        className="border-[var(--border-subtle)] hover:bg-[var(--surface-muted)]"
                      >
                        <TableCell className="text-[15px] font-medium text-[var(--text-primary)] ">
                          {job.stage}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={job.status} />
                        </TableCell>
                        <TableCell className="text-[15px] text-[var(--text-muted)]">
                          {job.retryCount}
                        </TableCell>
                        <TableCell className="text-[15px] text-[var(--text-muted)]">
                          {durationStr}
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate text-[13px] text-[var(--danger)]">
                          {job.errorMessage ?? "—"}
                        </TableCell>
                        <TableCell className="text-[13px] text-[var(--text-muted)]">
                          {formatDateTime(job.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {videoJobs.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-[15px] text-[var(--text-secondary)]"
                      >
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
              <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                ANALYTICS SNAPSHOTS
              </p>
              <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] ">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow className="border-[var(--border-subtle)] hover:bg-transparent ">
                      {[
                        "Fetched",
                        "Views",
                        "Likes",
                        "Comments",
                        "CTR",
                        "AVD",
                      ].map((h) => (
                        <TableHead
                          key={h}
                          className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]"
                        >
                          {h}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.map((row) => (
                      <TableRow
                        key={row.id}
                        className="border-[var(--border-subtle)] hover:bg-[var(--surface-muted)] "
                      >
                        <TableCell className="text-[13px] text-[var(--text-muted)]">
                          {formatDateTime(row.fetchedAt)}
                        </TableCell>
                        <TableCell className="text-[15px] text-[var(--text-primary)] ">
                          {row.views}
                        </TableCell>
                        <TableCell className="text-[15px] text-[var(--text-muted)]">
                          {row.likes ?? "—"}
                        </TableCell>
                        <TableCell className="text-[15px] text-[var(--text-muted)]">
                          {row.comments ?? "—"}
                        </TableCell>
                        <TableCell className="text-[15px] text-[var(--text-muted)]">
                          {row.ctrBasisPoints != null
                            ? `${(row.ctrBasisPoints / 100).toFixed(2)}%`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-[15px] text-[var(--text-muted)]">
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
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                  TTS
                </p>
                <TtsStatusBadge status={ttsStatus} />
              </div>
              {ttsStatus === "done" && video.audioUrl ? (
                <AudioCard
                  src={video.audioUrl}
                  persona={video.featuredPerson}
                  title={video.title}
                />
              ) : ttsStatus === "waiting_submit" ||
                ttsStatus === "submitted" ||
                ttsStatus === "running" ? (
                <AudioCardPending />
              ) : ttsStatus === "no_mapping" ? (
                <AudioCardNoMapping featuredPerson={video.featuredPerson} />
              ) : null}
            </section>
          )}
          <RenderPanel
            videoId={video.id}
            initialSnapshot={{
              audioUrl: video.audioUrl,
              renderStatus: video.renderStatus,
              renderError: video.renderError,
              renderAttemptCount: video.renderAttemptCount,
              renderNextAttemptAt: video.renderNextAttemptAt,
              renderRequestedAt: video.renderRequestedAt,
              renderStartedAt: video.renderStartedAt,
              renderFinishedAt: video.renderFinishedAt,
              renderHeartbeatAt: video.renderHeartbeatAt,
              outputAvailable,
              subtitleAvailable,
              chaptersAvailable: Boolean(chapterText),
              chapterLines: chapterText?.split("\n") ?? [],
              outputCurrent:
                outputAvailable &&
                video.renderStatus === "done" &&
                video.audioUrl === video.renderedAudioUrl,
              waitingForAudio: !video.audioUrl,
              missingTtsText: Boolean(video.audioUrl && !video.ttsText),
            }}
          />
        </div>
      </div>
    </>
  );
}
