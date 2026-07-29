import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  listStudyAudioWeeks,
  listStudyDailyVideos,
} from "@/lib/db/repo/study";
import {
  getStudyDayPaths,
  getStudyWeekPaths,
  isFreshStudyAssembly,
  isFreshStudyPreview,
  STUDY_MAX_WEEKS,
  STUDY_TOTAL_DAYS,
} from "@/lib/study/project";
import {
  CreateDayForm,
  CreateWeekForm,
  StudyDayActions,
  StudyWeekActions,
} from "./StudyControls";

export const dynamic = "force-dynamic";

function manifestCount(value: unknown): number {
  if (!value || typeof value !== "object" || !("files" in value)) return 0;
  return Array.isArray(value.files) ? value.files.length : 0;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "Not scanned";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function statusClass(status: string): string {
  if (status === "ready" || status === "done") {
    return "border-0 bg-[var(--success-soft)] text-[var(--success)]";
  }
  if (status === "assembling" || status === "generating") {
    return "border-0 bg-[var(--warning-soft)] text-[var(--warning)]";
  }
  if (status === "awaiting_rights") {
    return "border-0 bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)]";
  }
  if (status === "failed") {
    return "border-0 bg-[var(--danger-soft)] text-[var(--danger)]";
  }
  return "border-0 bg-[var(--surface-muted)] text-[var(--text-secondary)]";
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

export default async function StudyPage() {
  let weeks: Awaited<ReturnType<typeof listStudyAudioWeeks>> = [];
  let videos: Awaited<ReturnType<typeof listStudyDailyVideos>> = [];
  let dbError: string | null = null;

  try {
    [weeks, videos] = await Promise.all([
      listStudyAudioWeeks(),
      listStudyDailyVideos(),
    ]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
    console.error("[study] database unavailable", dbError);
  }

  const nextWeek = Math.min(
    STUDY_MAX_WEEKS,
    Math.max(1, ...weeks.map((week) => week.weekNumber + 1)),
  );
  const nextDay = Math.min(
    STUDY_TOTAL_DAYS,
    Math.max(1, ...videos.map((video) => video.dayNumber + 1)),
  );
  const weekNumberById = new Map(
    weeks.map((week) => [week.id, week.weekNumber]),
  );

  return (
    <>
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text-primary)]">
          Study Video Assembler
        </h1>
        <p className="mt-1 text-[15px] leading-relaxed text-[var(--text-muted)]">
          Combine daily MP4 footage with a reusable 20-track weekly playlist.
        </p>
      </div>

      {dbError && (
        <Card className="rounded-xl border-[var(--danger)]/30 bg-[var(--danger-soft)] shadow-none">
          <CardContent className="p-5 text-[13px] text-[var(--danger)]">
            Database unavailable: {dbError}
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-xl border-[var(--border-subtle)] bg-[var(--surface)] shadow-none">
          <CardHeader>
            <CardTitle>Weekly audio</CardTitle>
            <CardDescription>
              Create a week, generate 20 tracks, then confirm commercial rights.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateWeekForm defaultWeek={nextWeek} maxWeek={STUDY_MAX_WEEKS} />
          </CardContent>
        </Card>
        <Card className="rounded-xl border-[var(--border-subtle)] bg-[var(--surface)] shadow-none">
          <CardHeader>
            <CardTitle>Daily footage</CardTitle>
            <CardDescription>
              Create a day, copy 16:9 MP4 files into source, then assemble.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateDayForm defaultDay={nextDay} maxDay={STUDY_TOTAL_DAYS} />
          </CardContent>
        </Card>
      </section>

      <section>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
          Weekly audio packs
        </p>
        {weeks.length === 0 ? (
          <Card className="rounded-xl border-[var(--border-subtle)] bg-[var(--surface)] shadow-none">
            <CardContent className="p-5 text-[13px] text-[var(--text-muted)]">
              No audio week yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {weeks.map((week) => {
              const paths = getStudyWeekPaths(week.weekNumber);
              return (
                <Card
                  key={week.id}
                  className="rounded-xl border-[var(--border-subtle)] bg-[var(--surface)] shadow-none"
                >
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle>Week {week.weekNumber}</CardTitle>
                      <Badge className={statusClass(week.status)}>
                        {statusLabel(week.status)}
                      </Badge>
                    </div>
                    <CardDescription>
                      {manifestCount(week.trackManifest)}/20 tracks / {formatDuration(week.totalDurationSec)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <StudyWeekActions
                      weekId={week.id}
                      audioFolderPath={paths.audioDir}
                      status={week.status}
                      generationManifest={
                        (week as typeof week & { generationManifest?: unknown }).generationManifest
                      }
                    />
                    {week.errorMessage && (
                      <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-[var(--danger)]">
                        {week.errorMessage}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
          Daily videos
        </p>
        {videos.length === 0 ? (
          <Card className="rounded-xl border-[var(--border-subtle)] bg-[var(--surface)] shadow-none">
            <CardContent className="p-5 text-[13px] text-[var(--text-muted)]">
              No daily video yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {videos.map((video) => {
              const paths = getStudyDayPaths(video.dayNumber);
              const weekNumber = weekNumberById.get(video.weekId);
              return (
                <Card
                  key={video.id}
                  className="rounded-xl border-[var(--border-subtle)] bg-[var(--surface)] shadow-none"
                >
                  <CardContent className="p-4">
                    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="text-[15px] font-medium text-[var(--text-primary)]">
                            Day {video.dayNumber}
                          </h2>
                          <Badge className={statusClass(video.status)}>
                            {statusLabel(video.status)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                          Week {weekNumber ?? "?"} / {manifestCount(video.footageManifest)} clips / {formatDuration(video.durationSec)}
                        </p>
                        {video.finalVideoPath && (
                          <p className="mt-1 max-w-xl truncate font-mono text-[11px] text-[var(--text-secondary)]" title={video.finalVideoPath}>
                            {paths.finalVideoPath}
                          </p>
                        )}
                        {video.errorMessage && (
                          <p className="mt-2 text-[12px] text-[var(--danger)]">
                            {video.errorMessage}
                          </p>
                        )}
                      </div>
                      <StudyDayActions
                      videoId={video.id}
                      sourceFolderPath={paths.sourceDir}
                      outputFolderPath={paths.outputDir}
                       status={video.status}
                       isFreshAssembly={isFreshStudyAssembly(
                         video.status,
                         video.assemblyStartedAt,
                       )}
                       previewStatus={video.previewStatus}
                       previewActualOffsetSec={video.previewActualOffsetSec}
                       previewErrorMessage={video.previewErrorMessage}
                       isFreshPreview={isFreshStudyPreview(
                         video.previewStatus,
                         video.previewHeartbeatAt,
                       )}
                     />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
