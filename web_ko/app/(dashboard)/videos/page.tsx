import Link from "next/link";

import { listKoVideos } from "@/lib/db/repo/videos";
import { formatDate, StatusPill } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function VideosPage() {
  const videos = await listKoVideos();
  return <div className="space-y-6"><header><p className="eyebrow">Kho nội dung</p><h1 className="display mt-2 text-4xl font-bold">Toàn bộ kịch bản</h1></header><section className="paper-card p-4 md:p-6"><div className="table-wrap"><table><thead><tr><th>ID</th><th>Video nguồn</th><th>Tiến độ</th><th>Cập nhật</th></tr></thead><tbody>{videos.map((video) => <tr key={video.id}><td className="font-black">#{video.id}</td><td className="min-w-72"><Link href={`/videos/${video.id}`} className="font-bold hover:text-[var(--seal)]">{video.sourceTitle ?? "Đang lấy tiêu đề..."}</Link><p className="muted mt-1 max-w-xl truncate text-xs">{video.sourceUrl}</p></td><td><StatusPill status={video.status} />{video.currentSectionIndex ? <p className="muted mt-1 text-[11px]">Phần {video.currentSectionIndex}</p> : null}</td><td className="muted whitespace-nowrap text-xs">{formatDate(video.updatedAt)}</td></tr>)}</tbody></table></div></section></div>;
}
