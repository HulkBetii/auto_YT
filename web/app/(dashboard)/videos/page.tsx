import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { videos, videoStatusEnum } from "@/lib/db/schema";
import { StatusTabs } from "./StatusTabs";
import { VideosTable } from "./VideosTable";

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

      <VideosTable rows={rows} />
    </>
  );
}
