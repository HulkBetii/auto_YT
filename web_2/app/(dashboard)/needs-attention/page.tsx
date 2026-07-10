import Link from "next/link";
import { listNeedsAttentionAhVideos } from "@/lib/db/repo/videos";
import { listFailedAhJobsByVideo } from "@/lib/db/repo/jobs";
import {
  formatDateTime,
  formatRelative,
  statusBadgeClass,
} from "@/lib/ui/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RetryButton } from "../videos/[id]/RetryButton";
import { RetryVideoButton } from "../videos/[id]/RetryVideoButton";
export const dynamic = "force-dynamic";
export default async function NeedsAttentionPage() {
  const videos = await listNeedsAttentionAhVideos();
  const videosWithJobs = await Promise.all(
    videos.map(async (v) => ({
      video: v,
      failedJobs: await listFailedAhJobsByVideo(v.id),
    })),
  );
  return (
    <>
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text-primary)] ">
          Needs Attention
        </h1>
        <p className="mt-1 text-[15px] leading-relaxed text-[var(--text-muted)] ">
          Videos stuck in pipeline — review errors and retry failed jobs.
        </p>
      </div>
      {videosWithJobs.length === 0 ? (
        <Card className="border-[var(--border-subtle)] bg-[var(--surface)] shadow-none rounded-xl ">
          <CardContent className="p-12 text-center text-[15px] text-[var(--text-secondary)]">
            All clear — no videos need attention.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {videosWithJobs.map(({ video, failedJobs }) => {
            const topic = video.chosenTopic as { title?: string } | null;
            const title = topic?.title ?? `Video #${video.id}`;
            return (
              <Card
                key={video.id}
                className="border-[var(--danger)]/20 shadow-none rounded-xl "
              >
                <CardContent className="p-5 space-y-4">
                  {/* Video header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/videos/${video.id}`}
                        className="text-[17px] font-medium text-[var(--text-primary)] hover:text-[var(--accent-cyan)] transition-colors truncate block"
                      >
                        {title}
                      </Link>
                      <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                        Video #{video.id} · Updated
                        {formatRelative(video.updatedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <RetryVideoButton videoId={video.id} />
                      <Badge
                        className={`text-[12px] ${statusBadgeClass(video.status)}`}
                      >
                        {video.status}
                      </Badge>
                    </div>
                  </div>
                  {/* Failed jobs */}
                  {failedJobs.length > 0 ? (
                    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] ">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="border-b border-[var(--border-subtle)] bg-[var(--dashboard-bg)] ">
                            <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                              Stage
                            </th>
                            <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                              Error
                            </th>
                            <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                              Failed at
                            </th>
                            <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {failedJobs.map((j) => (
                            <tr
                              key={j.id}
                              className="border-b border-[var(--border-subtle)] last:border-0 "
                            >
                              <td className="px-3 py-2">
                                <Badge className="font-mono text-[11px] bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0 ">
                                  {j.stage}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 max-w-[300px]">
                                <span className="text-[12px] text-[var(--danger)] font-mono break-all line-clamp-2">
                                  {j.errorMessage ?? "Unknown error"}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">
                                {formatDateTime(j.finishedAt)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <RetryButton jobId={j.id} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-[13px] text-[var(--text-secondary)]">
                      No failed jobs — use Retry video to resume from the next
                      pipeline stage.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
