import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { videos, videoStatusEnum } from "@/lib/db/schema";
import {
  renderedSubtitleExists,
  renderedVideoExists,
} from "@/lib/render/files";
import { buildTTSStatusChecker } from "@/lib/pipeline/ttsVoiceMap";
import { StatusTabs } from "./StatusTabs";
import { VideosTable } from "./VideosTable";
export const dynamic = "force-dynamic";
const ALL = "all";
type StatusFilter = (typeof videoStatusEnum.enumValues)[number] | typeof ALL;
async function getVideos(filter: StatusFilter) {
  if (filter === ALL) {
    return db.select().from(videos).orderBy(desc(videos.createdAt)).limit(100);
  }
  return db
    .select()
    .from(videos)
    .where(eq(videos.status, filter))
    .orderBy(desc(videos.createdAt))
    .limit(100);
}
export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter: StatusFilter = (
    videoStatusEnum.enumValues as readonly string[]
  ).includes(status ?? "")
    ? (status as StatusFilter)
    : ALL;
  const videosList = await getVideos(filter);
  const ttsStatusFn = await buildTTSStatusChecker();
  const rows = await Promise.all(
    videosList.map(async (video) => {
      const [outputAvailable, subtitleAvailable] = await Promise.all([
        renderedVideoExists(video.id),
        renderedSubtitleExists(video.id),
      ]);
      return {
        ...video,
        outputAvailable,
        subtitleAvailable,
        outputCurrent:
          outputAvailable &&
          video.renderStatus === "done" &&
          video.audioUrl === video.renderedAudioUrl,
        ttsStatus: ttsStatusFn({
          featuredPerson: video.featuredPerson,
          audioUrl: video.audioUrl,
          ttsTaskId: video.ttsTaskId,
          ttsSubmittedAt: video.ttsSubmittedAt,
        }),
      };
    }),
  );
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text-primary)] ">
          Video
        </h1>
      </div>
      <StatusTabs current={filter} statuses={videoStatusEnum.enumValues} />
      <VideosTable rows={rows} />
    </>
  );
}
