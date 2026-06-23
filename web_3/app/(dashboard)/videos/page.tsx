import Link from "next/link";

import { listDrEpisodes } from "@/lib/db/repo/episodes";
import type { SceneInput } from "@/lib/db/schema";
import { statusBadgeClass, VIDEO_STATUS_LABELS, formatRelative } from "@/lib/ui/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CreateVideoButton } from "../CreateVideoButton";

export const dynamic = "force-dynamic";

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "d1_pending", label: "Visual" },
  { key: "d2a_pending", label: "Audio" },
  { key: "suno_pending", label: "Music" },
  { key: "d3_pending", label: "Thumb" },
  { key: "d4_pending", label: "Package" },
  { key: "ready", label: "Ready" },
  { key: "published", label: "Published" },
  { key: "needs_attention", label: "Failed" },
] as const;

export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const activeStatus = status && status !== "all" ? status : undefined;

  type FilterStatus = Parameters<typeof listDrEpisodes>[0];
  const filter: FilterStatus =
    activeStatus === "published"
      ? { published: true }
      : activeStatus
        ? { status: activeStatus as NonNullable<FilterStatus>["status"] }
        : undefined;
  const episodes = await listDrEpisodes(filter, 50);

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
          Episodes
        </h1>
        <CreateVideoButton />
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const isActive = tab.key === (status ?? "all");
          return (
            <Link
              key={tab.key}
              href={tab.key === "all" ? "/videos" : `/videos?status=${tab.key}`}
              className={[
                "rounded-full px-3 py-1 text-[13px] font-medium transition-colors duration-150 min-h-[30px] flex items-center",
                isActive
                  ? "bg-[#007AFF] text-white"
                  : "bg-white text-[#6E6E73] hover:bg-[#E5E5EA] dark:bg-[#2C2C2E] dark:text-[#AEAEB2] dark:hover:bg-white/[.08]",
              ].join(" ")}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <Card className="border-black/[.08] bg-white shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
        <CardContent className="p-0 divide-y divide-black/[.06] dark:divide-white/[.08]">
          {episodes.map((ep) => {
            const scene = ep.sceneInput as SceneInput | null;
            const title = ep.ytTitle ?? scene?.scene_name ?? `Episode #${ep.id}`;
            return (
              <Link
                key={ep.id}
                href={`/videos/${ep.id}`}
                className="group flex items-center gap-4 px-4 py-3 transition-colors duration-150 hover:bg-[#F2F2F7] dark:hover:bg-white/[.03]"
              >
                <span className="shrink-0 font-mono text-[13px] text-[#AEAEB2]">#{ep.id}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] text-[#1C1C1E] dark:text-white">
                  {title}
                </span>
                {ep.publishedAt && (
                  <Badge className="shrink-0 text-[11px] bg-[#D1F2D1] text-[#1A7A1A] border-0">
                    Published
                  </Badge>
                )}
                <Badge className={`shrink-0 text-[11px] ${statusBadgeClass(ep.status)}`}>
                  {VIDEO_STATUS_LABELS[ep.status] ?? ep.status}
                </Badge>
                <span className="shrink-0 text-[13px] text-[#AEAEB2] group-hover:text-[#6E6E73] transition-colors duration-150">
                  {formatRelative(ep.createdAt)}
                </span>
              </Link>
            );
          })}
          {episodes.length === 0 && (
            <p className="px-4 py-8 text-center text-[15px] text-[#AEAEB2]">
              No episodes yet.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
