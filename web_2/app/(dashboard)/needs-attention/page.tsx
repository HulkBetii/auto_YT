import Link from "next/link";
import { listNeedsAttentionAhVideos } from "@/lib/db/repo/videos";
import { listFailedAhJobsByVideo } from "@/lib/db/repo/jobs";
import { formatDateTime, formatRelative, statusBadgeClass } from "@/lib/ui/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RetryButton } from "../videos/[id]/RetryButton";

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
      <div className="mb-2">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
          Needs Attention
        </h1>
        <p className="mt-1 text-[15px] text-[#6E6E73]">
          Videos stuck in pipeline — review errors and retry failed jobs.
        </p>
      </div>

      {videosWithJobs.length === 0 ? (
        <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
          <CardContent className="p-8 text-center text-[#AEAEB2]">
            All clear — no videos need attention.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {videosWithJobs.map(({ video, failedJobs }) => {
            const topic = video.chosenTopic as { title?: string } | null;
            const title = topic?.title ?? `Video #${video.id}`;
            return (
              <Card key={video.id} className="border-[#FF3B30]/20 shadow-none rounded-xl dark:border-[#FF3B30]/20 dark:bg-[#1C1C1E]">
                <CardContent className="p-5 space-y-4">
                  {/* Video header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/videos/${video.id}`}
                        className="text-[17px] font-medium text-[#1C1C1E] hover:text-[#007AFF] dark:text-white transition-colors truncate block"
                      >
                        {title}
                      </Link>
                      <p className="mt-0.5 text-[13px] text-[#AEAEB2]">
                        Video #{video.id} · Updated {formatRelative(video.updatedAt)}
                      </p>
                    </div>
                    <Badge className={`shrink-0 text-[12px] ${statusBadgeClass(video.status)}`}>
                      {video.status}
                    </Badge>
                  </div>

                  {/* Failed jobs */}
                  {failedJobs.length > 0 ? (
                    <div className="overflow-hidden rounded-lg border border-black/[.06] dark:border-white/[.08]">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="border-b border-black/[.06] dark:border-white/[.08] bg-[#F2F2F7] dark:bg-white/[.04]">
                            <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Stage</th>
                            <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Error</th>
                            <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Failed at</th>
                            <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {failedJobs.map((j) => (
                            <tr key={j.id} className="border-b border-black/[.04] last:border-0 dark:border-white/[.06]">
                              <td className="px-3 py-2">
                                <Badge className="font-mono text-[11px] bg-[#E5E5EA] text-[#3C3C43] border-0 dark:bg-white/[.10] dark:text-[#AEAEB2]">
                                  {j.stage}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 max-w-[300px]">
                                <span className="text-[12px] text-[#FF3B30] font-mono break-all line-clamp-2">
                                  {j.errorMessage ?? "Unknown error"}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-[#AEAEB2] whitespace-nowrap">
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
                    <p className="text-[13px] text-[#AEAEB2]">No failed jobs — may have been manually consumed.</p>
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
