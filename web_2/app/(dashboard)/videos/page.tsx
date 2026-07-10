import Link from "next/link";
import { listAhVideos } from "@/lib/db/repo/videos";
import { listAvailableAhPromptSets } from "@/lib/db/repo/prompt-versions";
import {
  statusBadgeClass,
  VIDEO_STATUS_LABELS,
  formatRelative,
} from "@/lib/ui/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CreateVideoButton } from "../CreateVideoButton";
import { bgmBadgeClass, bgmStatusLabel } from "@/lib/ui/bgm";
export const dynamic = "force-dynamic";
function promptSetLabel(promptSetVersion: string): string {
  return promptSetVersion
    .replace("2.1-Mack-YT", "2.1 Mack")
    .replace("2.2-Stickly-YT", "2.2 Stickly")
    .replace("2.3-Explain-In-Paint-YT", "2.3 Explain");
}

function promptSetBadgeClass(promptSetVersion: string): string {
  if (promptSetVersion.startsWith("2.1")) {
    return "bg-cyan-500/10 text-cyan-300 border-cyan-400/20";
  }
  if (promptSetVersion.startsWith("2.2")) {
    return "bg-amber-500/10 text-amber-300 border-amber-400/20";
  }
  if (promptSetVersion.startsWith("2.3")) {
    return "bg-violet-500/10 text-violet-300 border-violet-400/20";
  }
  return "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-[var(--border-subtle)]";
}

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "s1_pending", label: "S1" },
  { key: "s2_pending", label: "S2" },
  { key: "tts_pending", label: "TTS" },
  { key: "s3_pending", label: "S3" },
  { key: "s4_pending", label: "S4" },
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
  type FilterStatus = Parameters<typeof listAhVideos>[0];
  const filter: FilterStatus =
    activeStatus === "published"
      ? { published: true }
      : activeStatus
        ? { status: activeStatus as NonNullable<FilterStatus>["status"] }
        : undefined;
  const videos = await listAhVideos(filter, 50);
  const promptSets = await listAvailableAhPromptSets();
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text-primary)] ">
          Videos
        </h1>
        <CreateVideoButton promptSets={promptSets} />
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
                "rounded-full px-3 py-1 text-[13px] font-medium transition-colors duration-150 min-h-[30px] flex items-center",
                isActive
                  ? "bg-[var(--accent-cyan)] text-[var(--dashboard-bg)]"
                  : "bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-muted)]",
              ].join(" ")}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <Card className="border-[var(--border-subtle)] bg-[var(--surface)] shadow-none rounded-xl ">
        <CardContent className="p-0 divide-y divide-[var(--border-subtle)] ">
          {videos.map((v) => {
            const topic = v.chosenTopic as { title?: string } | null;
            const title = topic?.title ?? `Video #${v.id}`;
            return (
              <Link
                key={v.id}
                href={`/videos/${v.id}`}
                className="group flex items-center gap-4 px-4 py-3 transition-colors duration-150 hover:bg-[var(--dashboard-bg)]"
              >
                <span className="shrink-0 font-mono text-[13px] text-[var(--text-secondary)]">
                  #{v.id}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-[15px] text-[var(--text-primary)] ">
                      {title}
                    </span>
                    <Badge
                      title={v.promptSetVersion}
                      className={`shrink-0 border px-2 py-0 text-[10px] font-medium ${promptSetBadgeClass(v.promptSetVersion)}`}
                    >
                      {promptSetLabel(v.promptSetVersion)}
                    </Badge>
                    <Badge
                      title={`BGM: ${bgmStatusLabel(v.bgmStatus)}`}
                      className={`shrink-0 border px-2 py-0 text-[10px] font-medium ${bgmBadgeClass(v.bgmStatus)}`}
                    >
                      BGM {bgmStatusLabel(v.bgmStatus)}
                    </Badge>
                  </div>
                </div>
                {v.publishedAt && (
                  <Badge className="shrink-0 text-[11px] bg-[var(--success-soft)] text-[var(--success)] border-0">
                    Published
                  </Badge>
                )}
                <Badge
                  className={`shrink-0 text-[11px] ${statusBadgeClass(v.status)}`}
                >
                  {VIDEO_STATUS_LABELS[v.status] ?? v.status}
                </Badge>
                <span className="shrink-0 text-[13px] text-[var(--text-secondary)] group-hover:text-[var(--text-muted)] transition-colors duration-150">
                  {formatRelative(v.createdAt)}
                </span>
              </Link>
            );
          })}
          {videos.length === 0 && (
            <p className="px-4 py-8 text-center text-[15px] text-[var(--text-secondary)]">
              No videos yet.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

