"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { StatusBadge } from "@/components/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAdaptiveLabel, formatListCount } from "@/lib/ui/adaptive";
import {
  formatPersonaName,
  getPersonaStatusLabel,
  getPersonaUiStatus,
} from "@/lib/ui/fixedPersona";
import { formatDateTime, scoreColorClass } from "@/lib/ui/format";

type VideoRow = {
  id: number;
  title: string | null;
  featuredPerson: string | null;
  contentArchetype: string | null;
  personaMode: string | null;
  hookType: string | null;
  commentMode: string | null;
  listCount: number | null;
  corePromise: string | null;
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
  const allChecked =
    allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someChecked = selected.size > 0 && !allChecked;

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(allIds));
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
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
      console.log(`[delete] Deleted ${deleted} video(s)`);
    } finally {
      setIsDeleting(false);
    }
  }

  const busy = isDeleting || isPending;

  return (
    <>
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-2.5">
          <span className="text-[14px] font-medium text-[var(--danger)]">
            {selected.size} video được chọn
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(new Set())}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] disabled:opacity-50"
            >
              Bỏ chọn
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="rounded-lg bg-[var(--danger)] px-3 py-1.5 text-[13px] font-medium text-[var(--dashboard-bg)] transition-colors hover:bg-[var(--danger)] disabled:opacity-50"
            >
              {isDeleting ? "Đang xóa…" : `Xóa ${selected.size} video`}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)]">
        <Table>
          <TableHeader>
            <TableRow className="border-[var(--border-subtle)] hover:bg-transparent">
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked;
                  }}
                  onChange={toggleAll}
                  className="h-4 w-4 cursor-pointer rounded border-[var(--border-strong)] accent-[var(--accent-cyan)]"
                  aria-label="Chọn tất cả"
                />
              </TableHead>
              <TableHead className="w-12 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                ID
              </TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                Title
              </TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                Persona
              </TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                Status
              </TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                Score
              </TableHead>
              <TableHead className="w-16 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                Audio
              </TableHead>
              <TableHead className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                Created
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((video) => {
              const isSelected = selected.has(video.id);
              const personaStatus = getPersonaUiStatus(video.featuredPerson);
              return (
                <TableRow
                  key={video.id}
                  className={[
                    "cursor-pointer border-[var(--border-subtle)] transition-colors",
                    isSelected
                      ? "bg-[var(--accent-cyan)]/[.06] hover:bg-[var(--accent-cyan)]/[.08]"
                      : "hover:bg-[var(--surface-muted)]",
                  ].join(" ")}
                  onClick={() => toggleOne(video.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(video.id)}
                      className="h-4 w-4 cursor-pointer rounded border-[var(--border-strong)] accent-[var(--accent-cyan)]"
                    />
                  </TableCell>
                  <TableCell className="text-[13px] text-[var(--text-secondary)]">
                    #{video.id}
                  </TableCell>
                  <TableCell className="max-w-[420px]">
                    <Link
                      href={`/videos/${video.id}`}
                      title={video.title ?? undefined}
                      onClick={(e) => e.stopPropagation()}
                      className="block truncate text-[15px] font-medium text-[var(--text-primary)] transition-colors duration-150 hover:text-[var(--accent-cyan)]"
                    >
                      {video.title}
                    </Link>
                    {(video.contentArchetype ||
                      video.hookType ||
                      video.commentMode ||
                      video.listCount != null) && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {video.contentArchetype && (
                          <span
                            title="Content archetype"
                            className="rounded-full bg-[var(--accent-cyan-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-cyan)]"
                          >
                            {formatAdaptiveLabel(video.contentArchetype)}
                          </span>
                        )}
                        {video.hookType && (
                          <span
                            title="Hook type"
                            className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
                          >
                            {formatAdaptiveLabel(video.hookType)}
                          </span>
                        )}
                        {video.commentMode && (
                          <span
                            title="Comment mode"
                            className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
                          >
                            {formatAdaptiveLabel(video.commentMode)}
                          </span>
                        )}
                        {video.listCount != null && (
                          <span
                            title="List count"
                            className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
                          >
                            {formatListCount(video.listCount)}
                          </span>
                        )}
                      </div>
                    )}
                    {video.corePromise && (
                      <p
                        title={video.corePromise}
                        className="mt-1 line-clamp-1 text-[12px] text-[var(--text-muted)]"
                      >
                        {video.corePromise}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-[15px] text-[var(--text-muted)]">
                    <div className="flex items-center gap-1.5">
                      <span>{formatPersonaName(video.featuredPerson)}</span>
                      {personaStatus !== "missing" && (
                        <span
                          title={
                            personaStatus === "fixed"
                              ? "Backend fixed persona"
                              : "Legacy video created before fixed persona strategy"
                          }
                          className={[
                            "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase",
                            personaStatus === "fixed"
                              ? "bg-[var(--success-soft)] text-[var(--success)]"
                              : "bg-[var(--warning-soft)] text-[var(--warning)]",
                          ].join(" ")}
                        >
                          {getPersonaStatusLabel(personaStatus)}
                        </span>
                      )}
                    </div>
                    {video.personaMode && (
                      <div className="mt-1 text-[12px] text-[var(--text-secondary)]">
                        Mode: {formatAdaptiveLabel(video.personaMode)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={video.status} />
                  </TableCell>
                  <TableCell>
                    <span
                      className={`text-[15px] font-medium ${scoreColorClass(video.score)}`}
                    >
                      {video.score != null ? `${video.score} / 100` : "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {video.audioUrl ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--success)]">
                        ♪ Audio
                      </span>
                    ) : (
                      <span className="text-[var(--text-secondary)]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[13px] text-[var(--text-muted)]">
                    {formatDateTime(video.createdAt)}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-12 text-center text-[15px] text-[var(--text-secondary)]"
                >
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
