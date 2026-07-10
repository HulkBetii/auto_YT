import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getAhVideo } from "@/lib/db/repo/videos";
import { listAhJobsByVideo } from "@/lib/db/repo/jobs";
import {
  statusBadgeClass,
  VIDEO_STATUS_LABELS,
  formatDateTime,
  formatDuration,
} from "@/lib/ui/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "./CopyButton";
import { RetryButton } from "./RetryButton";
import { RetryVideoButton } from "./RetryVideoButton";
import { DeleteVideoButton } from "./DeleteVideoButton";
import { PublishToggle } from "./PublishToggle";
import { OpenFolderButton } from "./OpenFolderButton";
import { bgmBadgeClass, bgmStatusLabel } from "@/lib/ui/bgm";
import {
  countManualProjectImages,
  getManualImageProjectInfo,
} from "@/lib/manual-image-project";
export const dynamic = "force-dynamic";
const PIPELINE_STEPS = [
  "S1",
  "S2",
  "TTS",
  "S3",
  "S4",
  "IMG",
  "ASSEMBLE",
] as const;
const STATUS_DONE_STEPS: Record<string, number> = {
  s1_pending: 0,
  s2_pending: 1,
  tts_pending: 2,
  s3_pending: 3,
  s4_pending: 4,
  ready: 5,
  image_gen_pending: 5,
  assembly_pending: 6,
  assembly_done: 7,
  needs_attention: -1,
};
const STATUS_ACTIVE_STEP: Record<string, number> = {
  s1_pending: 0,
  s2_pending: 1,
  tts_pending: 2,
  s3_pending: 3,
  s4_pending: 4,
  ready: -1,
  image_gen_pending: 5,
  assembly_pending: 6,
  assembly_done: -1,
  needs_attention: -1,
};
type YouTubeChapter = { time?: string; title?: string };
type YouTubeThumbnailConcept = {
  concept?: string;
  text?: string;
  emotion?: string;
  accent_color?: string;
};
type BgmTrack = {
  zone?: string;
  status?: string;
  taskId?: string;
  prompt?: string;
  audioUrl?: string;
  duration?: number;
  creditCost?: number;
  errorMessage?: string;
};
export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const videoId = parseInt(id, 10);
  if (isNaN(videoId)) notFound();
  const [video, jobs] = await Promise.all([
    getAhVideo(videoId),
    listAhJobsByVideo(videoId),
  ]);
  if (!video) notFound();
  const topic = video.chosenTopic as { title?: string; angle?: string } | null;
  const ytChapters = Array.isArray(video.ytChapters)
    ? (video.ytChapters as YouTubeChapter[])
    : [];
  const ytThumbnail =
    video.ytThumbnail &&
    typeof video.ytThumbnail === "object" &&
    !Array.isArray(video.ytThumbnail)
      ? (video.ytThumbnail as YouTubeThumbnailConcept)
      : null;
  const bgmTracks = Array.isArray(video.bgmTracks)
    ? (video.bgmTracks as BgmTrack[])
    : [];
  const doneCount = STATUS_DONE_STEPS[video.status] ?? 0;
  const activeStep = STATUS_ACTIVE_STEP[video.status] ?? -1;
  const promptCount = video.imagePrompts
    ? video.imagePrompts.split("\n").filter((l) => l.trim()).length
    : 0;
  const manualProject = getManualImageProjectInfo(video);
  const liveImageCount = countManualProjectImages(
    manualProject.imageOutputDir,
    manualProject.promptCount,
  );
  const displayImageCount = Math.max(video.imageCount ?? 0, liveImageCount);
  const displayImageCountExpected = Math.max(
    video.imageCountExpected ?? 0,
    manualProject.promptCount,
  );
  const showManualImages =
    video.status === "ready" ||
    video.status === "image_gen_pending" ||
    video.status === "assembly_pending" ||
    video.status === "assembly_done";
  const canOpenLocalFolders = !process.env.VERCEL;
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/videos"
            className="inline-flex items-center gap-1 text-[13px] text-[var(--accent-cyan)] hover:text-[var(--accent-cyan-hover)] transition-colors duration-150"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Videos
          </Link>
          <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-[var(--text-primary)] ">
            {topic?.title ?? `Video #${video.id}`}
          </h1>
          {topic?.angle && (
            <p className="mt-1 text-[15px] leading-relaxed text-[var(--text-muted)] ">
              {topic.angle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2 shrink-0">
          <Badge className={`text-[12px] ${statusBadgeClass(video.status)}`}>
            {VIDEO_STATUS_LABELS[video.status] ?? video.status}
          </Badge>
          <Badge className={`border text-[12px] ${bgmBadgeClass(video.bgmStatus)}`}>
            BGM {bgmStatusLabel(video.bgmStatus)}
          </Badge>
          {video.publishedAt && (
            <Badge className="text-[12px] bg-[var(--success-soft)] text-[var(--success)] border-0">
              Published
            </Badge>
          )}
          {video.status !== "assembly_done" && (
            <RetryVideoButton videoId={video.id} />
          )}
          <DeleteVideoButton videoId={video.id} />
        </div>
      </div>
      {/* Pipeline stepper */}
      <Card className="border-[var(--border-subtle)] bg-[var(--surface)] shadow-none rounded-xl ">
        <CardContent className="p-5">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
            PIPELINE PROGRESS
          </p>
          <div className="flex items-center gap-px flex-wrap">
            {PIPELINE_STEPS.map((step, i) => {
              const isDone = i < doneCount;
              const isRunning = i === activeStep;
              return (
                <div key={step} className="flex items-center gap-px">
                  <div
                    className={[
                      "flex items-center justify-center rounded-md px-2.5 py-1 text-[11px] font-medium tracking-wide",
                      isRunning
                        ? "bg-[var(--warning)]/10 text-[var(--warning)] animate-pulse ring-1 ring-inset ring-[var(--warning)]/20"
                        : isDone
                          ? "bg-[var(--success)]/10 text-[var(--success)]"
                          : "bg-[var(--surface-muted)] text-[var(--text-secondary)] ",
                    ].join(" ")}
                  >
                    {step}
                  </div>
                  {i < PIPELINE_STEPS.length - 1 && (
                    <div
                      className={`h-px w-3 ${i < doneCount ? "bg-[var(--success)]/30" : "bg-[var(--surface-muted)] "}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      {/* Publish marker */}
      <PublishToggle
        videoId={video.id}
        publishedAt={
          video.publishedAt ? new Date(video.publishedAt).toISOString() : null
        }
        youtubeUrl={video.youtubeUrl ?? null}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: info sidebar */}
        <div className="space-y-4">
          <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
            <CardContent className="p-5 space-y-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                  Voice ID
                </p>
                <p className="mt-0.5 text-[15px] text-[var(--text-primary)] font-mono">
                  {video.voiceId ?? "—"}
                </p>
              </div>
              {video.audioUrl && (
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                    Audio
                  </p>
                  <audio
                    controls
                    src={video.audioUrl}
                    className="mt-1 w-full h-8"
                  />
                </div>
              )}
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                  BGM
                </p>
                <Badge className={`mt-1 border text-[11px] ${bgmBadgeClass(video.bgmStatus)}`}>
                  {bgmStatusLabel(video.bgmStatus)}
                </Badge>
                {video.bgmError && (
                  <p className="mt-2 text-[12px] text-[var(--danger)] break-words">
                    {video.bgmError}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                  Created
                </p>
                <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
                  {formatDateTime(video.createdAt)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                  Updated
                </p>
                <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
                  {formatDateTime(video.updatedAt)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
        {/* Right: content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Script */}
          {video.script && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                  SCRIPT
                </p>
                <CopyButton text={video.script} />
              </div>
              <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
                <CardContent className="p-4">
                  <p className="text-[14px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed line-clamp-6">
                    {video.script}
                  </p>
                </CardContent>
              </Card>
            </section>
          )}
          {/* Whisper transcript */}
          {video.whisperTranscript && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                  WHISPER TRANSCRIPT
                </p>
                <CopyButton text={video.whisperTranscript} />
              </div>
              <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
                <CardContent className="p-4 max-h-72 overflow-y-auto">
                  <div className="space-y-1">
                    {video.whisperTranscript
                      .split("\n")
                      .filter((l) => l.trim())
                      .map((line, i) => {
                        const m = line.match(/^(\[\d{2}:\d{2}\])\s*(.*)/);
                        if (m) {
                          return (
                            <div
                              key={i}
                              className="flex gap-2 text-[13px] leading-relaxed"
                            >
                              <span className="shrink-0 font-mono text-[var(--accent-cyan)]">
                                {m[1]}
                              </span>
                              <span className="text-[var(--text-secondary)] ">
                                {m[2]}
                              </span>
                            </div>
                          );
                        }
                        return (
                          <p
                            key={i}
                            className="text-[13px] text-[var(--text-secondary)] leading-relaxed"
                          >
                            {line}
                          </p>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
            </section>
          )}
          {/* Image prompts */}
          {video.imagePrompts && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                  IMAGE PROMPTS · {promptCount} scenes
                </p>
                <a
                  href={`/api/videos/${video.id}/prompts`}
                  download
                  className="rounded-md bg-[var(--accent-cyan)] px-3 py-1 text-[12px] font-medium text-[var(--dashboard-bg)] hover:bg-[var(--accent-cyan-hover)] transition-colors duration-150"
                >
                  Download .txt
                </a>
              </div>
              <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
                <CardContent className="p-4">
                  <pre className="text-[12px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed line-clamp-6 font-mono">
                    {video.imagePrompts.split("\n").slice(0, 5).join("\n")}
                    {promptCount > 5 && `\n… and ${promptCount - 5} more`}
                  </pre>
                </CardContent>
              </Card>
            </section>
          )}
          {/* YouTube metadata */}
          {(video.ytTitle ||
            video.ytUrlSlug ||
            video.ytDescription ||
            video.ytTags ||
            ytChapters.length > 0 ||
            ytThumbnail) && (
            <section>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                YOUTUBE METADATA
              </p>
              <div className="space-y-3">
                {video.ytTitle && (
                  <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)] mb-1">
                            Title
                          </p>
                          <p className="text-[15px] text-[var(--text-primary)] ">
                            {video.ytTitle}
                          </p>
                          {video.ytUrlSlug && (
                            <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--dashboard-bg)] p-3">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                                  URL Slug
                                </p>
                                <CopyButton text={video.ytUrlSlug} />
                              </div>
                              <p className="font-mono text-[13px] text-[var(--text-muted)] break-all">
                                {video.ytUrlSlug}
                              </p>
                            </div>
                          )}
                        </div>
                        <CopyButton text={video.ytTitle} />
                      </div>
                    </CardContent>
                  </Card>
                )}
                {video.ytDescription && (
                  <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)] mb-1">
                            Description
                          </p>
                          <p className="text-[14px] text-[var(--text-secondary)] whitespace-pre-wrap line-clamp-4">
                            {video.ytDescription}
                          </p>
                        </div>
                        <CopyButton text={video.ytDescription} />
                      </div>
                    </CardContent>
                  </Card>
                )}
                {video.ytTags && (
                  <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)] mb-1">
                            Tags
                          </p>
                          <p className="text-[13px] text-[var(--text-muted)] font-mono break-all line-clamp-3">
                            {video.ytTags}
                          </p>
                        </div>
                        <CopyButton text={video.ytTags} />
                      </div>
                    </CardContent>
                  </Card>
                )}
                {ytChapters.length > 0 && (
                  <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)] mb-1">
                            Chapters
                          </p>
                          <div className="space-y-1">
                            {ytChapters.map((chapter, index) => (
                              <p
                                key={`${chapter.time ?? index}-${chapter.title ?? ""}`}
                                className="text-[13px] text-[var(--text-secondary)] "
                              >
                                <span className="font-mono text-[var(--accent-cyan)]">
                                  {chapter.time ?? "—"}
                                </span>
                                <span className="ml-2">
                                  {chapter.title ?? "Untitled"}
                                </span>
                              </p>
                            ))}
                          </div>
                        </div>
                        <CopyButton
                          text={ytChapters
                            .map((c) =>
                              `${c.time ?? ""} ${c.title ?? ""}`.trim(),
                            )
                            .join("\n")}
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}
                {ytThumbnail && (
                  <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)] mb-1">
                            Thumbnail
                          </p>
                          <p className="text-[14px] text-[var(--text-secondary)] whitespace-pre-wrap">
                            {ytThumbnail.concept ?? "—"}
                          </p>
                          <p className="mt-2 text-[12px] text-[var(--text-muted)] ">
                            Text:
                            <span className="font-mono">
                              {ytThumbnail.text ?? ""}
                            </span>
                            {ytThumbnail.emotion
                              ? ` · Emotion: ${ytThumbnail.emotion}`
                              : ""}
                            {ytThumbnail.accent_color
                              ? ` · Accent: ${ytThumbnail.accent_color}`
                              : ""}
                          </p>
                        </div>
                        <CopyButton
                          text={JSON.stringify(ytThumbnail, null, 2)}
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </section>
          )}
          {/* Background music */}
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                BACKGROUND MUSIC
              </p>
              <Badge className={`border text-[11px] ${bgmBadgeClass(video.bgmStatus)}`}>
                {bgmStatusLabel(video.bgmStatus)}
              </Badge>
            </div>
            <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
              <CardContent className="p-4 space-y-4">
                {bgmTracks.length > 0 ? (
                  <div className="grid gap-3">
                    {bgmTracks.map((track, index) => (
                      <div
                        key={`${track.zone ?? "zone"}-${track.taskId ?? index}`}
                        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--dashboard-bg)] p-3"
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--text-primary)]">
                              {track.zone ?? `Track ${index + 1}`}
                            </p>
                            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                              {track.status ?? "pending"}
                              {track.taskId ? ` · ${track.taskId}` : ""}
                              {track.duration
                                ? ` · ${formatDuration(track.duration)}`
                                : ""}
                            </p>
                          </div>
                          {track.prompt && <CopyButton text={track.prompt} />}
                        </div>
                        {track.audioUrl && (
                          <audio
                            controls
                            src={track.audioUrl}
                            className="mb-2 h-8 w-full"
                          />
                        )}
                        <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                          {track.prompt ?? "No prompt yet."}
                        </p>
                        {track.errorMessage && (
                          <p className="mt-2 text-[12px] text-[var(--danger)]">
                            {track.errorMessage}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-[var(--text-secondary)]">
                    BGM generation has not started yet.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {video.videoPath && (
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                        Clean Final
                      </p>
                      <p className="mt-0.5 text-[12px] font-mono text-[var(--text-muted)] break-all">
                        {video.videoPath}
                      </p>
                    </div>
                  )}
                  {video.bgmVideoPath && (
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                          BGM Final
                        </p>
                        <OpenFolderButton
                          filePath={video.bgmVideoPath}
                          title="Open BGM video folder"
                        />
                      </div>
                      <p className="text-[12px] font-mono text-[var(--success)] break-all">
                        {video.bgmVideoPath}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </section>
          {/* Manual image and assembly status */}
          {showManualImages && (
            <section>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                MANUAL IMAGES
              </p>
              <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
                <CardContent className="p-5 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                        Project
                      </p>
                      <p className="mt-0.5 text-[13px] font-mono text-[var(--text-primary)] break-all">
                        {manualProject.projectName}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                        Prompt Count
                      </p>
                      <p className="mt-0.5 text-[13px] font-mono text-[var(--text-primary)] ">
                        {manualProject.promptCount}
                      </p>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                        Image Output Dir
                      </p>
                      {canOpenLocalFolders && (
                        <OpenFolderButton
                          filePath={manualProject.imageOutputDir}
                          label="Open Folder"
                          title="Open image output folder"
                        />
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] font-mono text-[var(--accent-cyan)] break-all">
                      {manualProject.imageOutputDir}
                    </p>
                  </div>
                  {displayImageCountExpected > 0 && (
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                        Manual Images
                      </p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <p className="text-[22px] font-semibold leading-none text-[var(--accent-cyan)]">
                          {displayImageCount}
                          <span className="text-[15px] font-normal text-[var(--text-secondary)]">
                            /{displayImageCountExpected}
                          </span>
                        </p>
                        <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-muted)] overflow-hidden">
                          <div
                            className="h-1.5 rounded-full bg-[var(--accent-cyan)] transition-all duration-150"
                            style={{
                              width: `${Math.min(100, Math.max(0, Math.round((displayImageCount / Math.max(1, displayImageCountExpected)) * 100)))}%`,
                            }}
                          />
                        </div>
                        <span className="text-[13px] text-[var(--text-muted)] shrink-0">
                          {Math.min(
                            100,
                            Math.max(
                              0,
                              Math.round(
                                (displayImageCount /
                                  Math.max(1, displayImageCountExpected)) *
                                  100,
                              ),
                            ),
                          )}
                          %
                        </span>
                      </div>
                    </div>
                  )}
                  {video.videoPath && (
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                          Video Path
                        </p>
                        <OpenFolderButton
                          filePath={video.videoPath}
                          title="Open video folder"
                        />
                      </div>
                      <p className="mt-0.5 text-[13px] font-mono text-[var(--success)] break-all">
                        {video.videoPath}
                      </p>
                    </div>
                  )}
                  {video.status === "image_gen_pending" &&
                    displayImageCountExpected === 0 && (
                      <p className="text-[13px] text-[var(--accent-cyan)] flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)] animate-pulse inline-block" />
                        Đang chờ ảnh thủ công từ RUN_VEO…
                      </p>
                    )}
                  {!video.videoPath && video.status === "assembly_pending" && (
                    <p className="text-[13px] text-[var(--warning)] flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)] animate-pulse inline-block" />
                      Đang assemble video…
                    </p>
                  )}
                </CardContent>
              </Card>
            </section>
          )}
          {/* Jobs table */}
          <section>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
              JOBS
            </p>
            <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] ">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] ">
                    <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                      ID
                    </th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                      Stage
                    </th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                      Status
                    </th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                      Error
                    </th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                      Duration
                    </th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => {
                    const duration =
                      j.startedAt && j.finishedAt
                        ? (new Date(j.finishedAt).getTime() -
                            new Date(j.startedAt).getTime()) /
                          1000
                        : null;
                    return (
                      <tr
                        key={j.id}
                        className="border-b border-[var(--border-subtle)] last:border-0 "
                      >
                        <td className="px-4 py-2 font-mono text-[var(--text-secondary)]">
                          #{j.id}
                        </td>
                        <td className="px-4 py-2">
                          <Badge className="font-mono text-[11px] bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0 ">
                            {j.stage}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            className={`text-[11px] ${statusBadgeClass(j.status)}`}
                          >
                            {j.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 max-w-[220px]">
                          {j.errorMessage ? (
                            <span
                              className="text-[11px] text-[var(--danger)] font-mono break-all line-clamp-2"
                              title={j.errorMessage}
                            >
                              {j.errorMessage}
                            </span>
                          ) : j.status === "failed" ? (
                            <RetryButton jobId={j.id} />
                          ) : (
                            <span className="text-[var(--text-secondary)]">
                              —
                            </span>
                          )}
                          {j.status === "failed" && j.errorMessage && (
                            <RetryButton jobId={j.id} />
                          )}
                        </td>
                        <td className="px-4 py-2 text-[var(--text-muted)]">
                          {formatDuration(duration)}
                        </td>
                        <td className="px-4 py-2 text-[var(--text-secondary)]">
                          {formatDateTime(j.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                  {jobs.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-6 text-center text-[var(--text-secondary)]"
                      >
                        No jobs yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

