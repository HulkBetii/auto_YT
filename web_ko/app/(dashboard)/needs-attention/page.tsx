import Link from "next/link";

import { listKoVideos } from "@/lib/db/repo/videos";
import { formatDate } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function NeedsAttentionPage() {
  const videos = await listKoVideos({ status: "needs_attention" });
  return <div className="space-y-6"><header><p className="eyebrow">Fail closed</p><h1 className="display mt-2 text-4xl font-bold">Cần người vận hành</h1><p className="muted mt-3 max-w-2xl text-sm leading-7">Model, effort, profile, transcript hoặc nội dung không đạt chuẩn đều dừng ở đây. Hệ thống không tự chọn phương án thay thế.</p></header><section className="space-y-3">{videos.map((video) => <Link key={video.id} href={`/videos/${video.id}`} className="paper-card block p-5 transition hover:-translate-y-0.5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">#{video.id} · {video.errorCode}</p><h2 className="display mt-1 text-xl font-bold">{video.sourceTitle ?? video.sourceUrl}</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--seal-dark)]">{video.errorMessage}</p></div><span className="muted text-xs">{formatDate(video.updatedAt)}</span></div></Link>)}{videos.length === 0 ? <div className="paper-card p-12 text-center"><div className="display text-4xl">平安</div><p className="muted mt-3 text-sm">Không có project nào cần xử lý.</p></div> : null}</section></div>;
}
