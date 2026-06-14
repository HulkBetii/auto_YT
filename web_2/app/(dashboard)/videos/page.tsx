import Link from "next/link";

import { listAhVideos } from "@/lib/db/repo/videos";
import { statusBadgeClass, VIDEO_STATUS_LABELS, formatRelative } from "@/lib/ui/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CreateVideoButton } from "../CreateVideoButton";

export const dynamic = "force-dynamic";

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "s1_pending", label: "S1" },
  { key: "s2_pending", label: "S2" },
  { key: "tts_pending", label: "TTS" },
  { key: "s3_pending", label: "S3" },
  { key: "s4_pending", label: "S4" },
  { key: "ready", label: "Ready" },
  { key: "needs_attention", label: "Failed" },
] as const;

export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const activeStatus = status && status !== "all" ? status : undefined;

  type FilterStatus = Parameters<typeof listAhVideos>[0];
  const filter: FilterStatus = activeStatus
    ? { status: activeStatus as NonNullable<FilterStatus>["status"] }
    : undefined;
  const videos = await listAhVideos(filter, 50);

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
          Videos
        </h1>
        <CreateVideoButton />
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const isActive = tab.key === (status ?? "all");
          return (
            <Link
              key={tab.key}
              href={tab.key === "all" ? "/videos" : `/videos?status=${tab.key}`}
              className={[
                "rounded-full px-3 py-1 text-[13px] font-medium transition-colors duration-150",
                isActive
                  ? "bg-[#007AFF] text-white"
                  : "bg-white text-[#6E6E73] hover:bg-[#E5E5EA] dark:bg-[#1C1C1E] dark:text-[#AEAEB2] dark:hover:bg-white/[.08]",
              ].join(" ")}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
        <CardContent className="p-0 divide-y divide-black/[.06] dark:divide-white/[.08]">
          {videos.map((v) => {
            const topic = v.chosenTopic as { title?: string } | null;
            const title = topic?.title ?? `Video #${v.id}`;
            return (
              <Link
                key={v.id}
                href={`/videos/${v.id}`}
                className="flex items-center gap-4 px-4 py-3 transition-colors duration-150 hover:bg-black/[.02] dark:hover:bg-white/[.03]"
              >
                <span className="shrink-0 font-mono text-[13px] text-[#AEAEB2]">#{v.id}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] text-[#1C1C1E] dark:text-white">
                  {title}
                </span>
                <Badge className={`shrink-0 text-[11px] ${statusBadgeClass(v.status)}`}>
                  {VIDEO_STATUS_LABELS[v.status] ?? v.status}
                </Badge>
                <span className="shrink-0 text-[13px] text-[#AEAEB2]">
                  {formatRelative(v.createdAt)}
                </span>
              </Link>
            );
          })}
          {videos.length === 0 && (
            <p className="px-4 py-8 text-center text-[15px] text-[#AEAEB2]">
              No videos yet.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
