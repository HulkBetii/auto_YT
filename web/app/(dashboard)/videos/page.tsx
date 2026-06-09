import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { videos, videoStatusEnum } from "@/lib/db/schema";
import { formatDateTime, scoreColorClass } from "@/lib/ui/format";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusTabs } from "./StatusTabs";

export const dynamic = "force-dynamic";

const ALL = "all";
type StatusFilter = (typeof videoStatusEnum.enumValues)[number] | typeof ALL;

async function getVideos(filter: StatusFilter) {
  if (filter === ALL) {
    return db.select().from(videos).orderBy(desc(videos.createdAt)).limit(100);
  }
  return db.select().from(videos).where(eq(videos.status, filter)).orderBy(desc(videos.createdAt)).limit(100);
}

export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter: StatusFilter = (videoStatusEnum.enumValues as readonly string[]).includes(status ?? "")
    ? (status as StatusFilter)
    : ALL;

  const rows = await getVideos(filter);

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
          Video
        </h1>
      </div>

      <StatusTabs current={filter} statuses={videoStatusEnum.enumValues} />

      <div className="overflow-hidden rounded-xl border border-black/[.08] bg-white dark:border-white/[.10] dark:bg-[#1C1C1E]">
        <Table>
          <TableHeader>
            <TableRow className="border-black/[.06] hover:bg-transparent dark:border-white/[.08]">
              <TableHead className="w-12 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                ID
              </TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                Title
              </TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                Character
              </TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                Status
              </TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                Score
              </TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                Created
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((video) => (
              <TableRow
                key={video.id}
                className="border-black/[.06] hover:bg-black/[.02] dark:border-white/[.08] dark:hover:bg-white/[.03]"
              >
                <TableCell className="text-[13px] text-[#AEAEB2]">#{video.id}</TableCell>
                <TableCell className="max-w-[320px]">
                  <Link
                    href={`/videos/${video.id}`}
                    title={video.title}
                    className="block truncate text-[15px] font-medium text-[#1C1C1E] transition-colors duration-150 hover:text-[#007AFF] dark:text-white"
                  >
                    {video.title}
                  </Link>
                </TableCell>
                <TableCell className="text-[15px] text-[#6E6E73]">
                  {video.featuredPerson ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={video.status} />
                </TableCell>
                <TableCell>
                  <span className={`text-[15px] font-medium ${scoreColorClass(video.score)}`}>
                    {video.score != null ? `${video.score} / 100` : "—"}
                  </span>
                </TableCell>
                <TableCell className="text-[13px] text-[#6E6E73]">
                  {formatDateTime(video.createdAt)}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-[15px] text-[#AEAEB2]">
                  Không có video nào khớp bộ lọc này.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
