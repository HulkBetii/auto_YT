"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { formatDateTime, scoreColorClass } from "@/lib/ui/format";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type VideoRow = {
  id: number;
  title: string | null;
  featuredPerson: string | null;
  status: string;
  score: number | null;
  audioUrl: string | null;
  createdAt: Date | null;
};

export function VideosTable({ rows }: { rows: VideoRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [isDeleting, setIsDeleting] = useState(false);

  const allIds = rows.map((r) => r.id);
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someChecked = selected.size > 0 && !allChecked;

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(allIds));
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleDelete() {
    if (selected.size === 0) return;
    const confirmed = window.confirm(
      `Xóa ${selected.size} video đã chọn? Thao tác này không thể hoàn tác.`,
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      const res = await fetch("/api/videos/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Lỗi: ${err.error ?? res.statusText}`);
        return;
      }
      const { deleted } = await res.json();
      setSelected(new Set());
      startTransition(() => router.refresh());
      // Brief feedback
      console.log(`[delete] Deleted ${deleted} video(s)`);
    } finally {
      setIsDeleting(false);
    }
  }

  const busy = isDeleting || isPending;

  return (
    <>
      {/* Toolbar — only visible when something is selected */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-[#FF3B30]/30 bg-[#FFE5E5] px-4 py-2.5 dark:border-[#FF3B30]/20 dark:bg-[#FF3B30]/10">
          <span className="text-[14px] font-medium text-[#FF3B30]">
            {selected.size} video được chọn
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(new Set())}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-[#6E6E73] hover:bg-black/[.06] disabled:opacity-50 transition-colors"
            >
              Bỏ chọn
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="rounded-lg bg-[#FF3B30] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#D70015] disabled:opacity-50 transition-colors"
            >
              {isDeleting ? "Đang xóa…" : `Xóa ${selected.size} video`}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-black/[.08] bg-white dark:border-white/[.10] dark:bg-[#1C1C1E]">
        <Table>
          <TableHeader>
            <TableRow className="border-black/[.06] hover:bg-transparent dark:border-white/[.08]">
              {/* Select-all checkbox */}
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleAll}
                  className="h-4 w-4 cursor-pointer rounded border-[#C7C7CC] accent-[#007AFF]"
                  aria-label="Chọn tất cả"
                />
              </TableHead>
              <TableHead className="w-12 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">ID</TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Title</TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Character</TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Status</TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Score</TableHead>
              <TableHead className="w-16 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Audio</TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((video) => {
              const isSelected = selected.has(video.id);
              return (
                <TableRow
                  key={video.id}
                  className={[
                    "border-black/[.06] dark:border-white/[.08] transition-colors cursor-pointer",
                    isSelected
                      ? "bg-[#007AFF]/[.06] hover:bg-[#007AFF]/[.08] dark:bg-[#007AFF]/[.10]"
                      : "hover:bg-black/[.02] dark:hover:bg-white/[.03]",
                  ].join(" ")}
                  onClick={() => toggleOne(video.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(video.id)}
                      className="h-4 w-4 cursor-pointer rounded border-[#C7C7CC] accent-[#007AFF]"
                    />
                  </TableCell>
                  <TableCell className="text-[13px] text-[#AEAEB2]">#{video.id}</TableCell>
                  <TableCell className="max-w-[300px]">
                    <Link
                      href={`/videos/${video.id}`}
                      title={video.title ?? undefined}
                      onClick={(e) => e.stopPropagation()}
                      className="block truncate text-[15px] font-medium text-[#1C1C1E] transition-colors duration-150 hover:text-[#007AFF] dark:text-white"
                    >
                      {video.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[15px] text-[#6E6E73]">{video.featuredPerson ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={video.status} /></TableCell>
                  <TableCell>
                    <span className={`text-[15px] font-medium ${scoreColorClass(video.score)}`}>
                      {video.score != null ? `${video.score} / 100` : "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {video.audioUrl ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#D1F2D1] px-2 py-0.5 text-[11px] font-medium text-[#1A7A1A]">
                        ♪ Audio
                      </span>
                    ) : (
                      <span className="text-[#AEAEB2]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[13px] text-[#6E6E73]">
                    {formatDateTime(video.createdAt)}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-[15px] text-[#AEAEB2]">
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
