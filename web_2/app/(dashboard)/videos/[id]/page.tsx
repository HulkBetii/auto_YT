import Link from "next/link";
import { notFound } from "next/navigation";

import { ChevronLeft } from "lucide-react";
import { getAhVideo } from "@/lib/db/repo/videos";
import { listAhJobsByVideo } from "@/lib/db/repo/jobs";
import { statusBadgeClass, VIDEO_STATUS_LABELS, formatDateTime, formatDuration } from "@/lib/ui/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "./CopyButton";
import { RetryButton } from "./RetryButton";
import { DeleteVideoButton } from "./DeleteVideoButton";
import { OpenFolderButton } from "./OpenFolderButton";
import { countManualProjectImages, getManualImageProjectInfo } from "@/lib/manual-image-project";

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

const STATUS_ACTIVE_STEP: Record<string, number> = {
  s1_pending:        0,
  s2_pending:        1,
  tts_pending:       2,
  s3_pending:        3,
  s4_pending:        4,
  ready:             -1,
  image_gen_pending: 5,
  assembly_pending:  6,
  assembly_done:     -1,
  needs_attention:   -1,
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
  const doneCount = STATUS_DONE_STEPS[video.status] ?? 0;
  const activeStep = STATUS_ACTIVE_STEP[video.status] ?? -1;

  const promptCount = video.imagePrompts
    ? video.imagePrompts.split("\n").filter((l) => l.trim()).length
    : 0;
  const manualProject = getManualImageProjectInfo(video);
  const liveImageCount = countManualProjectImages(manualProject.imageOutputDir, manualProject.promptCount);
  const displayImageCount = Math.max(video.imageCount ?? 0, liveImageCount);
  const displayImageCountExpected = Math.max(video.imageCountExpected ?? 0, manualProject.promptCount);
  const showManualImages =
    video.status === "ready" ||
    video.status === "image_gen_pending" ||
    video.status === "assembly_pending" ||
    video.status === "assembly_done";
  const canOpenLocalFolders = process.platform === "darwin" && !process.env.VERCEL;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/videos" className="inline-flex items-center gap-1 text-[13px] text-[#007AFF] hover:text-[#0062CC] transition-colors duration-150">
            <ChevronLeft className="h-3.5 w-3.5" />
            Videos
          </Link>
          <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
            {topic?.title ?? `Video #${video.id}`}
          </h1>
          {topic?.angle && (
            <p className="mt-1 text-[15px] leading-relaxed text-[#6E6E73] dark:text-[#AEAEB2]">{topic.angle}</p>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2 shrink-0">
          <Badge className={`text-[12px] ${statusBadgeClass(video.status)}`}>
            {VIDEO_STATUS_LABELS[video.status] ?? video.status}
          </Badge>
          <DeleteVideoButton videoId={video.id} />
        </div>
      </div>

      {/* Pipeline stepper */}
      <Card className="border-black/[.08] bg-white shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
        <CardContent className="p-5">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
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
                        ? "bg-[#FF9F0A]/10 text-[#FF9F0A] animate-pulse ring-1 ring-inset ring-[#FF9F0A]/20"
                        : isDone
                          ? "bg-[#34C759]/10 text-[#34C759]"
                          : "bg-[#E5E5EA] text-[#AEAEB2] dark:bg-white/[.05] dark:text-[#6E6E73]",
                    ].join(" ")}
                  >
                    {step}
                  </div>
                  {i < PIPELINE_STEPS.length - 1 && (
                    <div className={`h-px w-3 ${i < doneCount ? "bg-[#34C759]/30" : "bg-[#E5E5EA] dark:bg-white/[.08]"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: info sidebar */}
        <div className="space-y-4">
          <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
            <CardContent className="p-5 space-y-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Voice ID</p>
                <p className="mt-0.5 text-[15px] text-[#1C1C1E] dark:text-white font-mono">
                  {video.voiceId ?? "—"}
                </p>
              </div>
              {video.audioUrl && (
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Audio</p>
                  <audio controls src={video.audioUrl} className="mt-1 w-full h-8" />
                </div>
              )}
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Created</p>
                <p className="mt-0.5 text-[13px] text-[#6E6E73]">{formatDateTime(video.createdAt)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Updated</p>
                <p className="mt-0.5 text-[13px] text-[#6E6E73]">{formatDateTime(video.updatedAt)}</p>
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
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">SCRIPT</p>
                <CopyButton text={video.script} />
              </div>
              <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
                <CardContent className="p-4">
                  <p className="text-[14px] text-[#3C3C43] dark:text-[#AEAEB2] whitespace-pre-wrap leading-relaxed line-clamp-6">
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
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                  WHISPER TRANSCRIPT
                </p>
                <CopyButton text={video.whisperTranscript} />
              </div>
              <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
                <CardContent className="p-4 max-h-72 overflow-y-auto">
                  <div className="space-y-1">
                    {video.whisperTranscript.split("\n").filter((l) => l.trim()).map((line, i) => {
                      const m = line.match(/^(\[\d{2}:\d{2}\])\s*(.*)/);
                      if (m) {
                        return (
                          <div key={i} className="flex gap-2 text-[13px] leading-relaxed">
                            <span className="shrink-0 font-mono text-[#007AFF] dark:text-[#0A84FF]">{m[1]}</span>
                            <span className="text-[#3C3C43] dark:text-[#AEAEB2]">{m[2]}</span>
                          </div>
                        );
                      }
                      return (
                        <p key={i} className="text-[13px] text-[#3C3C43] dark:text-[#AEAEB2] leading-relaxed">{line}</p>
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
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                  IMAGE PROMPTS · {promptCount} scenes
                </p>
                <a
                  href={`/api/videos/${video.id}/prompts`}
                  download
                  className="rounded-md bg-[#007AFF] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#0062CC] transition-colors duration-150"
                >
                  Download .txt
                </a>
              </div>
              <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
                <CardContent className="p-4">
                  <pre className="text-[12px] text-[#3C3C43] dark:text-[#AEAEB2] whitespace-pre-wrap leading-relaxed line-clamp-6 font-mono">
                    {video.imagePrompts.split("\n").slice(0, 5).join("\n")}
                    {promptCount > 5 && `\n… and ${promptCount - 5} more`}
                  </pre>
                </CardContent>
              </Card>
            </section>
          )}

          {/* YouTube metadata */}
          {(video.ytTitle || video.ytDescription || video.ytTags) && (
            <section>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                YOUTUBE METADATA
              </p>
              <div className="space-y-3">
                {video.ytTitle && (
                  <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2] mb-1">Title</p>
                          <p className="text-[15px] text-[#1C1C1E] dark:text-white">{video.ytTitle}</p>
                        </div>
                        <CopyButton text={video.ytTitle} />
                      </div>
                    </CardContent>
                  </Card>
                )}
                {video.ytDescription && (
                  <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2] mb-1">Description</p>
                          <p className="text-[14px] text-[#3C3C43] dark:text-[#AEAEB2] whitespace-pre-wrap line-clamp-4">
                            {video.ytDescription}
                          </p>
                        </div>
                        <CopyButton text={video.ytDescription} />
                      </div>
                    </CardContent>
                  </Card>
                )}
                {video.ytTags && (
                  <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2] mb-1">Tags</p>
                          <p className="text-[13px] text-[#6E6E73] font-mono break-all line-clamp-3">
                            {video.ytTags}
                          </p>
                        </div>
                        <CopyButton text={video.ytTags} />
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </section>
          )}

          {/* Manual image and assembly status */}
          {showManualImages && (
            <section>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                MANUAL IMAGES
              </p>
              <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
                <CardContent className="p-5 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                        Project
                      </p>
                      <p className="mt-0.5 text-[13px] font-mono text-[#1C1C1E] dark:text-white break-all">
                        {manualProject.projectName}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                        Prompt Count
                      </p>
                      <p className="mt-0.5 text-[13px] font-mono text-[#1C1C1E] dark:text-white">
                        {manualProject.promptCount}
                      </p>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
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
                    <p className="mt-0.5 text-[13px] font-mono text-[#007AFF] break-all">
                      {manualProject.imageOutputDir}
                    </p>
                  </div>
                  {displayImageCountExpected > 0 && (
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                        Manual Images
                      </p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <p className="text-[22px] font-semibold leading-none text-[#007AFF]">
                          {displayImageCount}
                          <span className="text-[15px] font-normal text-[#AEAEB2]">
                            /{displayImageCountExpected}
                          </span>
                        </p>
                        <div className="flex-1 h-1.5 rounded-full bg-[#E5E5EA] dark:bg-white/[.10] overflow-hidden">
                          <div
                            className="h-1.5 rounded-full bg-[#007AFF] transition-all duration-150"
                            style={{
                              width: `${Math.min(100, Math.max(0, Math.round((displayImageCount / Math.max(1, displayImageCountExpected)) * 100)))}%`,
                            }}
                          />
                        </div>
                        <span className="text-[13px] text-[#6E6E73] shrink-0">
                          {Math.min(100, Math.max(0, Math.round((displayImageCount / Math.max(1, displayImageCountExpected)) * 100)))}%
                        </span>

                      </div>
                    </div>
                  )}
                  {video.videoPath && (
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                          Video Path
                        </p>
                        <OpenFolderButton filePath={video.videoPath} title="Open video folder" />
                      </div>
                      <p className="mt-0.5 text-[13px] font-mono text-[#34C759] break-all">
                        {video.videoPath}
                      </p>
                    </div>
                  )}
                  {video.status === "image_gen_pending" && displayImageCountExpected === 0 && (
                    <p className="text-[13px] text-[#007AFF] flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#007AFF] animate-pulse inline-block" />
                      Đang chờ ảnh thủ công từ RUN_VEO…
                    </p>
                  )}
                  {!video.videoPath && video.status === "assembly_pending" && (
                    <p className="text-[13px] text-[#FF9F0A] flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#FF9F0A] animate-pulse inline-block" />
                      Đang assemble video…
                    </p>
                  )}
                </CardContent>
              </Card>
            </section>
          )}

          {/* Jobs table */}
          <section>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">JOBS</p>
            <div className="overflow-hidden rounded-xl border border-black/[.08] bg-white dark:border-white/[.10] dark:bg-[#1C1C1E]">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-black/[.06] dark:border-white/[.08]">
                    <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">ID</th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Stage</th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Status</th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Error</th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Duration</th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => {
                    const duration =
                      j.startedAt && j.finishedAt
                        ? (new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime()) / 1000
                        : null;
                    return (
                      <tr
                        key={j.id}
                        className="border-b border-black/[.04] last:border-0 dark:border-white/[.06]"
                      >
                        <td className="px-4 py-2 font-mono text-[#AEAEB2]">#{j.id}</td>
                        <td className="px-4 py-2">
                          <Badge className="font-mono text-[11px] bg-[#E5E5EA] text-[#3C3C43] border-0 dark:bg-white/[.10] dark:text-[#AEAEB2]">
                            {j.stage}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge className={`text-[11px] ${statusBadgeClass(j.status)}`}>
                            {j.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 max-w-[220px]">
                          {j.errorMessage ? (
                            <span className="text-[11px] text-[#FF3B30] font-mono break-all line-clamp-2" title={j.errorMessage}>
                              {j.errorMessage}
                            </span>
                          ) : j.status === "failed" ? (
                            <RetryButton jobId={j.id} />
                          ) : (
                            <span className="text-[#AEAEB2]">—</span>
                          )}
                          {j.status === "failed" && j.errorMessage && (
                            <RetryButton jobId={j.id} />
                          )}
                        </td>
                        <td className="px-4 py-2 text-[#6E6E73]">{formatDuration(duration)}</td>
                        <td className="px-4 py-2 text-[#AEAEB2]">{formatDateTime(j.createdAt)}</td>
                      </tr>
                    );
                  })}
                  {jobs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-[#AEAEB2]">No jobs yet.</td>
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
