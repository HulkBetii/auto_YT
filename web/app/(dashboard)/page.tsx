import Link from "next/link";
import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, videoContent, videos } from "@/lib/db/schema";
import { getConfigValue } from "@/lib/db/repo/channel-config";
import { formatAdaptiveLabel, formatListCount } from "@/lib/ui/adaptive";
import {
  FIXED_PERSONA_NAME,
  formatPersonaName,
  getPersonaStatusLabel,
  getPersonaUiStatus,
} from "@/lib/ui/fixedPersona";
import { formatDuration, formatRelative } from "@/lib/ui/format";
import { buildTTSStatusChecker } from "@/lib/pipeline/ttsVoiceMap";
import { getWorkerHeartbeatSnapshot } from "@/lib/pipeline/workerHeartbeat";
import { renderedVideoExists } from "@/lib/render/files";
import { MAX_RENDER_ATTEMPTS } from "@/lib/render/state";
import { RenderStatusBadge } from "@/components/RenderStatusBadge";
import { TtsStatusBadge } from "@/components/TtsStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RunPipelineButton } from "./RunPipelineButton";
import { WorkerControl } from "./WorkerControl";
export const dynamic = "force-dynamic";
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

const ACTIVE_PIPELINE_STATUSES = new Set<string>([
  "topic",
  "outline",
  "scripted",
  "seo_done",
  "scoring",
  "needs_retry",
] as const);
const POST_SCORE_STATUSES = new Set<string>([
  "ready_to_publish",
  "published",
  "analyzed",
] as const);

const PIPELINE_STEPS = [
  "P1",
  "P2",
  "P3",
  "P4",
  "Score",
  "Desc",
  "TTS",
  "Render",
] as const;
type PipelineStep = (typeof PIPELINE_STEPS)[number];

const STATUS_DONE_STEPS: Record<string, number> = {
  topic: 1,
  outline: 2,
  scripted: 3,
  seo_done: 4,
  scoring: 4,
  needs_retry: 2,
  ready_to_publish: 6,
  published: 6,
  analyzed: 6,
};

const STATUS_RUNNING_STEP: Record<string, PipelineStep | null> = {
  topic: "P2",
  outline: "P3",
  scripted: "P4",
  seo_done: "Score",
  scoring: "Score",
  needs_retry: "P3",
  ready_to_publish: "TTS",
  published: "TTS",
  analyzed: "TTS",
};

async function getDashboardVideos() {
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      featuredPerson: videos.featuredPerson,
      contentArchetype: videos.contentArchetype,
      hookType: videos.hookType,
      commentMode: videos.commentMode,
      listCount: videos.listCount,
      corePromise: videos.corePromise,
      status: videos.status,
      audioUrl: videos.audioUrl,
      ttsText: videos.ttsText,
      ttsTaskId: videos.ttsTaskId,
      ttsSubmittedAt: videos.ttsSubmittedAt,
      renderStatus: videos.renderStatus,
      renderAttemptCount: videos.renderAttemptCount,
      renderNextAttemptAt: videos.renderNextAttemptAt,
      renderedAudioUrl: videos.renderedAudioUrl,
    })
    .from(videos)
    .orderBy(videos.id);

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      outputAvailable: await renderedVideoExists(row.id),
    })),
  );
}

type DashboardVideo = Awaited<ReturnType<typeof getDashboardVideos>>[number];

function isCurrentRenderComplete(video: DashboardVideo) {
  return (
    video.outputAvailable &&
    video.renderStatus === "done" &&
    video.audioUrl !== null &&
    video.audioUrl === video.renderedAudioUrl
  );
}

function isTerminalRenderFailure(video: DashboardVideo) {
  return (
    video.renderStatus === "failed" &&
    (video.renderAttemptCount >= MAX_RENDER_ATTEMPTS ||
      video.renderNextAttemptAt === null)
  );
}

function shouldShowInFlight(video: DashboardVideo) {
  if (ACTIVE_PIPELINE_STATUSES.has(video.status)) return true;
  if (!POST_SCORE_STATUSES.has(video.status)) return false;
  if (!video.audioUrl || !video.ttsText) return true;
  return !isCurrentRenderComplete(video) && !isTerminalRenderFailure(video);
}

async function attachRunningJobs(rows: DashboardVideo[]) {
  const filtered = rows.filter(shouldShowInFlight);
  if (filtered.length === 0) return [];

  const videoIds = filtered.map((v) => v.id);
  const runningJobs = await db
    .select({ videoId: jobs.videoId, stage: jobs.stage, status: jobs.status })
    .from(jobs)
    .where(
      sql`${jobs.videoId} = ANY(ARRAY[${sql.join(
        videoIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::int[]) AND ${jobs.status} IN ('pending', 'running')`,
    )
    .orderBy(desc(jobs.id));

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

function getPipelineProgress(video: DashboardVideo) {
  let doneCount = STATUS_DONE_STEPS[video.status] ?? 0;
  let runningStep = STATUS_RUNNING_STEP[video.status] ?? null;
  if (doneCount < 6) return { doneCount, runningStep };
  if (!video.audioUrl) return { doneCount, runningStep: "TTS" as const };
  doneCount = 7;
  runningStep = "Render";
  if (isCurrentRenderComplete(video)) {
    doneCount = 8;
    runningStep = null;
  }
  return { doneCount, runningStep };
}

export default async function DashboardPage() {
  const [
    avgDurations,
    recentActivity,
    ttsStatusFn,
    dashboardVideos,
    workerHeartbeat,
    newBatchPaused,
  ] = await Promise.all([
    getAvgStageDuration(),
    getRecentActivity(),
    buildTTSStatusChecker(),
    getDashboardVideos(),
    getWorkerHeartbeatSnapshot(),
    getConfigValue("new_batch_paused"),
  ]);
  const inFlightVideos = await attachRunningJobs(dashboardVideos);
  const audioCount = dashboardVideos.filter((video) => video.audioUrl).length;
  const renderDoneCount = dashboardVideos.filter(
    (video) => video.renderStatus === "done" && video.outputAvailable,
  ).length;
  const renderCurrentCount = dashboardVideos.filter(isCurrentRenderComplete).length;
  const needsActionIds = new Set(
    dashboardVideos
      .filter((video) => {
        const ttsStatus = ttsStatusFn({
          featuredPerson: video.featuredPerson,
          audioUrl: video.audioUrl,
          ttsTaskId: video.ttsTaskId,
          ttsSubmittedAt: video.ttsSubmittedAt,
        });
        return (
          video.status === "needs_attention" ||
          isTerminalRenderFailure(video) ||
          Boolean(video.audioUrl && !video.ttsText) ||
          (POST_SCORE_STATUSES.has(video.status) &&
            ttsStatus === "no_mapping")
        );
      })
      .map((video) => video.id),
  );
  const statCards = [
    { label: "VIDEO ĐANG CHẠY", value: inFlightVideos.length },
    { label: "AUDIO DONE", value: audioCount },
    {
      label: "RENDER CURRENT / DONE",
      value: `${renderCurrentCount} / ${renderDoneCount}`,
    },
    { label: "CẦN XỬ LÝ", value: needsActionIds.size },
  ];
  return (
    <>
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text-primary)] ">
            Tổng quan
          </h1>
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--success-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--success)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--success)]" />
            Live
          </span>
          <span className="rounded-full bg-[var(--accent-cyan-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-cyan)]">
            Persona: {FIXED_PERSONA_NAME}
          </span>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-3">
          <WorkerControl
            heartbeat={{
              workerLastSeenAt: workerHeartbeat.lastSeenAt,
              workerLastStatus: workerHeartbeat.status,
            }}
          />
          <RunPipelineButton
            newBatchPaused={newBatchPaused === "true"}
            initialWorker={workerHeartbeat}
          />
        </div>
      </div>
      {/* Stat cards */}
      <section>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
          PIPELINE STATUS
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {statCards.map((card) => (
            <Card
              key={card.label}
              className="border-[var(--border-subtle)] shadow-none rounded-xl "
            >
              <CardContent className="p-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                  {card.label}
                </p>
                <p className="mt-1 text-[34px] font-semibold leading-none text-[var(--text-primary)] ">
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
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
            ĐANG XỬ LÝ — {inFlightVideos.length} video
          </p>
          <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
            <CardContent className="p-0 divide-y divide-[var(--border-subtle)] ">
              {inFlightVideos.map((v) => {
                const { doneCount, runningStep } = getPipelineProgress(v);
                const personaStatus = getPersonaUiStatus(v.featuredPerson);
                const ttsStatus = ttsStatusFn({
                  featuredPerson: v.featuredPerson,
                  audioUrl: v.audioUrl,
                  ttsTaskId: v.ttsTaskId,
                  ttsSubmittedAt: v.ttsSubmittedAt,
                });
                return (
                  <div
                    key={v.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                  >
                    {/* Mini stepper */}
                    <div className="flex max-w-full shrink-0 items-center gap-1 overflow-x-auto pb-1">
                      {PIPELINE_STEPS.map((step, i) => {
                        const isDone = i < doneCount;
                        const isRunning = step === runningStep;
                        return (
                          <div key={step} className="flex items-center gap-1">
                            <div
                              className={[
                                "flex items-center justify-center rounded-full text-[10px] font-medium",
                                isRunning
                                  ? "h-6 px-2 bg-[var(--warning)] text-[var(--dashboard-bg)] animate-pulse"
                                  : isDone
                                    ? "h-6 px-2 bg-[var(--success)] text-[var(--dashboard-bg)]"
                                    : "h-6 px-2 bg-[var(--surface-muted)] text-[var(--text-secondary)] ",
                              ].join(" ")}
                            >
                              {step}
                            </div>
                            {i < PIPELINE_STEPS.length - 1 && (
                              <div
                                className={`h-px w-3 ${i < doneCount ? "bg-[var(--success)]" : "bg-[var(--surface-muted)] "}`}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Title + adaptive metadata */}
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/videos/${v.id}`}
                        className="block truncate text-[15px] text-[var(--text-primary)] transition-colors duration-150 hover:text-[var(--accent-cyan)]"
                      >
                        {v.title ?? `Video #${v.id}`}
                      </Link>
                      {(v.featuredPerson ||
                        v.contentArchetype ||
                        v.hookType ||
                        v.commentMode ||
                        v.listCount != null) && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {v.featuredPerson && (
                            <span
                              title={
                                personaStatus === "fixed"
                                  ? "Backend fixed persona"
                                  : "Legacy video created before fixed persona strategy"
                              }
                              className={[
                                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                                personaStatus === "fixed"
                                  ? "bg-[var(--success-soft)] text-[var(--success)]"
                                  : "bg-[var(--warning-soft)] text-[var(--warning)]",
                              ].join(" ")}
                            >
                              {formatPersonaName(v.featuredPerson)} ·{" "}
                              {getPersonaStatusLabel(personaStatus)}
                            </span>
                          )}
                          {v.contentArchetype && (
                            <span
                              title="Content archetype"
                              className="rounded-full bg-[var(--accent-cyan-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-cyan)]"
                            >
                              {formatAdaptiveLabel(v.contentArchetype)}
                            </span>
                          )}
                          {v.hookType && (
                            <span
                              title="Hook type"
                              className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
                            >
                              {formatAdaptiveLabel(v.hookType)}
                            </span>
                          )}
                          {v.commentMode && (
                            <span
                              title="Comment mode"
                              className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
                            >
                              {formatAdaptiveLabel(v.commentMode)}
                            </span>
                          )}
                          {v.listCount != null && (
                            <span
                              title="List count"
                              className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
                            >
                              {formatListCount(v.listCount)}
                            </span>
                          )}
                        </div>
                      )}
                      {v.corePromise && (
                        <p
                          title={v.corePromise}
                          className="mt-1 line-clamp-1 text-[12px] text-[var(--text-muted)]"
                        >
                          {v.corePromise}
                        </p>
                      )}
                    </div>
                    {/* Running job badge */}
                    {doneCount >= 6 && <TtsStatusBadge status={ttsStatus} />}
                    {v.audioUrl && (
                      <RenderStatusBadge
                        audioUrl={v.audioUrl}
                        ttsText={v.ttsText}
                        renderStatus={v.renderStatus}
                        renderAttemptCount={v.renderAttemptCount}
                        renderNextAttemptAt={v.renderNextAttemptAt}
                        outputAvailable={v.outputAvailable}
                        outputCurrent={isCurrentRenderComplete(v)}
                      />
                    )}
                    {v.runningJob && (
                      <Badge
                        className={[
                          "shrink-0 font-mono text-[11px] border-0",
                          v.runningJob.status === "running"
                            ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                            : "bg-[var(--surface-muted)] text-[var(--text-secondary)] ",
                        ].join(" ")}
                      >
                        {v.runningJob.status === "running"
                          ? "running"
                          : "pending"}
                        {v.runningJob.stage}
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
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
            PROCESSING TIME
          </p>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] ">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow className="border-[var(--border-subtle)] hover:bg-transparent ">
                  <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                    Stage
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                    Avg
                  </TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                    Samples
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {avgDurations.map((row) => (
                  <TableRow
                    key={row.stage}
                    className="border-[var(--border-subtle)] hover:bg-[var(--surface-muted)]"
                  >
                    <TableCell className="text-[15px] font-medium text-[var(--text-primary)] ">
                      {row.stage}
                    </TableCell>
                    <TableCell className="text-[15px] text-[var(--text-muted)]">
                      {formatDuration(row.avgSeconds)}
                    </TableCell>
                    <TableCell className="text-[15px] text-[var(--text-muted)]">
                      {row.count}
                    </TableCell>
                  </TableRow>
                ))}
                {avgDurations.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-8 text-center text-[15px] text-[var(--text-secondary)]"
                    >
                      Chưa có dữ liệu.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>
        <section>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
            RECENT ACTIVITY
          </p>
          <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
            <CardContent className="p-0 divide-y divide-[var(--border-subtle)] ">
              {recentActivity.map((row) => (
                <div key={row.id} className="flex items-center gap-3 px-4 py-3">
                  <Badge className="shrink-0 font-mono text-[12px] bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0 ">
                    {row.stage}
                  </Badge>
                  <Link
                    href={`/videos/${row.videoId}`}
                    className="min-w-0 flex-1 truncate text-[15px] text-[var(--text-primary)] transition-colors duration-150 hover:text-[var(--accent-cyan)] "
                  >
                    {row.videoTitle ?? `Video #${row.videoId}`}
                  </Link>
                  <span className="shrink-0 text-[13px] text-[var(--text-secondary)]">
                    {formatRelative(row.createdAt)}
                  </span>
                </div>
              ))}
              {recentActivity.length === 0 && (
                <p className="px-4 py-8 text-center text-[15px] text-[var(--text-secondary)]">
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
