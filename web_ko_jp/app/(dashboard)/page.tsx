import React from "react";
import { listKoJpVideos } from "@/lib/db/repo/videos";
import { listRecentKoJpJobs } from "@/lib/db/repo/jobs";
import type { KoJpVideo, KoJpJob } from "@/lib/db/schema";
import { YouTubeDramaCard } from "./YouTubeDramaCard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let videos: KoJpVideo[] = [];
  let recentJobs: KoJpJob[] = [];
  let dbError: string | null = null;

  try {
    [videos, recentJobs] = await Promise.all([
      listKoJpVideos(30),
      listRecentKoJpJobs(10),
    ]);
  } catch (err: any) {
    dbError = err.message || "Database connection error.";
  }

  const totalVideos = videos.length;
  const readyCount = videos.filter((v) => v.status === "ready").length;
  const inProgressCount = videos.filter(
    (v) => v.status !== "ready" && v.status !== "needs_attention",
  ).length;
  const attentionCount = videos.filter((v) => v.status === "needs_attention").length;

  return (
    <div className="space-y-6">
      {/* Top Banner / Heading */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#344254]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#F7FAFF]">
            KO-JP Localization Pipeline
          </h1>
          <p className="text-sm text-[#95A3B5] mt-1">
            Biên dịch, bản địa hoá và tái cấu trúc nội dung từ video Hàn Quốc (KO) sang tiếng Nhật (JP) chuẩn YouTube.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2.5 py-1 rounded-full border border-[#26D9FF]/40 text-[#26D9FF] bg-[#26D9FF]/10 mono">
            Target: 3000-3500 chars (JP)
          </span>
        </div>
      </div>

      {/* DB Connection Alert if error */}
      {dbError && (
        <div className="p-4 rounded-lg bg-[#FF5C7A]/10 border border-[#FF5C7A]/40 text-[#FF5C7A] text-sm">
          <div className="font-semibold mb-1">Chưa kết nối Database cục bộ (Port 5437):</div>
          <div className="text-xs text-[#F7FAFF] mb-2">{dbError}</div>
          <div className="mono text-xs bg-[#101821] p-2 rounded border border-[#344254] text-[#C3CEDB]">
            Chạy trong terminal web_ko_jp: <span className="text-[#26D9FF]">pnpm db:up</span> rồi{" "}
            <span className="text-[#26D9FF]">pnpm db:migrate</span>
          </div>
        </div>
      )}

      {/* 1-Click YouTube to Japanese Drama Script Card */}
      <YouTubeDramaCard />

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="panel-card">
          <div className="text-xs text-[#95A3B5] uppercase tracking-wider font-semibold">
            Tổng Video
          </div>
          <div className="text-2xl font-bold text-[#F7FAFF] mt-1">{totalVideos}</div>
        </div>
        <div className="panel-card">
          <div className="text-xs text-[#26D9FF] uppercase tracking-wider font-semibold">
            Đang xử lý
          </div>
          <div className="text-2xl font-bold text-[#26D9FF] mt-1">{inProgressCount}</div>
        </div>
        <div className="panel-card">
          <div className="text-xs text-[#43D17A] uppercase tracking-wider font-semibold">
            Sẵn sàng (Ready)
          </div>
          <div className="text-2xl font-bold text-[#43D17A] mt-1">{readyCount}</div>
        </div>
        <div className="panel-card">
          <div className="text-xs text-[#FF5C7A] uppercase tracking-wider font-semibold">
            Needs Attention
          </div>
          <div className="text-2xl font-bold text-[#FF5C7A] mt-1">{attentionCount}</div>
        </div>
      </div>

      {/* Content Form & Queue Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Create Video Form */}
        <div className="lg:col-span-1 panel-card space-y-4">
          <h2 className="text-base font-semibold text-[#F7FAFF] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#26D9FF]"></span>
            Tạo Video Mới
          </h2>
          <form action="/api/videos" method="POST" className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#C3CEDB] mb-1">
                URL Nguồn (YouTube / Video Link)
              </label>
              <input
                type="text"
                name="sourceUrl"
                placeholder="https://www.youtube.com/watch?v=..."
                required
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#C3CEDB] mb-1">
                Tiêu đề nguồn (Tuỳ chọn)
              </label>
              <input
                type="text"
                name="sourceTitle"
                placeholder="Ví dụ: 인생에서 가장 중요한 지혜..."
                className="input-field"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-[#C3CEDB] mb-1">
                  Ngôn ngữ nguồn
                </label>
                <select name="sourceLanguage" className="input-field">
                  <option value="ko">Hàn Quốc (KO)</option>
                  <option value="jp">Nhật Bản (JP)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#C3CEDB] mb-1">
                  Ngôn ngữ đích
                </label>
                <select name="targetLanguage" className="input-field">
                  <option value="jp">Nhật Bản (JP)</option>
                  <option value="ko">Hàn Quốc (KO)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#C3CEDB] mb-1">
                Phong cách chuyển thể (Adaptation)
              </label>
              <select name="adaptationMode" className="input-field">
                <option value="philosophical_insight">Triết lý chiêm nghiệm (哲人の刻 style)</option>
                <option value="storytelling">Kể chuyện cảm xúc (Emotional Storytelling)</option>
                <option value="practical_wisdom">Lời khuyên thực tế (Practical Advice)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#C3CEDB] mb-1">
                Transcript thô (Nếu đã có sẵn)
              </label>
              <textarea
                name="transcriptText"
                rows={4}
                placeholder="Dán nội dung transcript tiếng Hàn/Nhật tại đây..."
                className="input-field text-xs"
              ></textarea>
            </div>
            <button type="submit" className="btn-primary w-full mt-2">
              Đưa Vào Hàng Đợi (Enqueue)
            </button>
          </form>
        </div>

        {/* Right Column: Videos Table & Active Jobs */}
        <div className="lg:col-span-2 space-y-6">
          {/* Videos Table */}
          <div className="panel-card space-y-3">
            <h2 className="text-base font-semibold text-[#F7FAFF] flex items-center justify-between">
              <span>Danh Sách Video</span>
              <span className="text-xs font-normal text-[#95A3B5]">Hiển thị {videos.length} video gần nhất</span>
            </h2>
            {videos.length === 0 ? (
              <div className="text-center py-10 text-sm text-[#95A3B5] border border-dashed border-[#344254] rounded-lg">
                Chưa có video nào trong hàng đợi. Nhập link nguồn ở khung bên trái để bắt đầu.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#344254] text-[#95A3B5]">
                    <tr>
                      <th className="pb-2 font-medium">ID</th>
                      <th className="pb-2 font-medium">Tiêu đề / Link</th>
                      <th className="pb-2 font-medium">Chiều chuyển thể</th>
                      <th className="pb-2 font-medium">Trạng thái</th>
                      <th className="pb-2 font-medium">Thời gian</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#344254]/50">
                    {videos.map((v) => (
                      <tr key={v.id} className="hover:bg-[#121923]">
                        <td className="py-2.5 mono text-[#26D9FF]">#{v.id}</td>
                        <td className="py-2.5 max-w-[320px]">
                          <div className="flex items-center gap-2.5">
                            {v.thumbnailImageUrl ? (
                              <img
                                src={v.thumbnailImageUrl}
                                alt="Thumb"
                                className="w-16 h-9 object-cover rounded border border-[#344254] flex-shrink-0 shadow-sm"
                              />
                            ) : null}
                            <div className="truncate min-w-0">
                              <div className="font-medium text-[#F7FAFF] truncate" title={v.titleJp || v.sourceTitle || v.sourceUrl}>
                                {v.titleJp || v.sourceTitle || v.sourceUrl}
                              </div>
                              <div className="text-[10px] text-[#95A3B5] truncate flex items-center gap-2">
                                <span>{v.sourceTitle ? `${v.sourceTitle} • ` : ""}{v.sourceUrl}</span>
                                {v.audioUrl && (
                                  <a
                                    href={v.audioUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-1.5 py-0.5 rounded bg-[#26D9FF]/20 text-[#26D9FF] hover:underline font-mono text-[9px] shrink-0"
                                  >
                                    ▶ Audio WAV
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5">
                          <span className="px-1.5 py-0.5 rounded bg-[#101821] border border-[#344254] text-[#C3CEDB] uppercase">
                            {v.sourceLanguage} &rarr; {v.targetLanguage}
                          </span>
                        </td>
                        <td className="py-2.5">
                          <span
                            className={`status-badge ${
                              v.status === "ready"
                                ? "bg-[#43D17A]/10 text-[#43D17A] border border-[#43D17A]/30"
                                : v.status === "needs_attention"
                                ? "bg-[#FF5C7A]/10 text-[#FF5C7A] border border-[#FF5C7A]/30"
                                : "bg-[#26D9FF]/10 text-[#26D9FF] border border-[#26D9FF]/30"
                            }`}
                          >
                            {v.status}
                          </span>
                        </td>
                        <td className="py-2.5 text-[#95A3B5]">
                          {new Date(v.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Jobs */}
          <div className="panel-card space-y-3">
            <h2 className="text-base font-semibold text-[#F7FAFF]">
              Hàng Đợi Công Việc Gần Đây (Jobs)
            </h2>
            {recentJobs.length === 0 ? (
              <div className="text-xs text-[#95A3B5] py-4 text-center border border-dashed border-[#344254] rounded">
                Chưa có job nào đang chạy hoặc hoàn tất.
              </div>
            ) : (
              <div className="space-y-2">
                {recentJobs.map((j) => (
                  <div
                    key={j.id}
                    className="flex items-center justify-between p-2 rounded bg-[#101821] border border-[#344254] text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="mono text-[#26D9FF]">Job #{j.id}</span>
                      <span className="text-[#95A3B5]">&bull; Video #{j.videoId}</span>
                      <span className="px-1.5 py-0.5 rounded bg-[#18212C] text-[#C3CEDB] mono">
                        {j.stage}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[#95A3B5] mono">{j.modelLabel}</span>
                      <span
                        className={`status-badge ${
                          j.status === "done"
                            ? "text-[#43D17A] bg-[#43D17A]/10"
                            : j.status === "running"
                            ? "text-[#FFB020] bg-[#FFB020]/10"
                            : "text-[#95A3B5] bg-[#344254]/20"
                        }`}
                      >
                        {j.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
