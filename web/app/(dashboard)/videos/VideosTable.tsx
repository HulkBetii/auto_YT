"use client";

import Link from "next/link";
import { Captions, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { StatusBadge } from "@/components/StatusBadge";
import { RenderStatusBadge } from "@/components/RenderStatusBadge";
import { TtsStatusBadge } from "@/components/TtsStatusBadge";
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
import type { TtsUiState } from "@/lib/ui/operations";

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
  ttsText: string | null;
  ttsStatus: TtsUiState;
  renderStatus: string;
  renderAttemptCount: number;
  renderNextAttemptAt: Date | null;
  renderedAudioUrl: string | null;
  videoPath: string | null;
  outputAvailable: boolean;
  outputCurrent: boolean;
  subtitleAvailable: boolean;
  createdAt: Date | null;
};

export function VideosTable({ rows }: { rows: VideoRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<{
    tone: "success" | "warning" | "danger";
    text: string;
  } | null>(null);

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
    setDeleteMessage(null);
    try {
      const res = await fetch("/api/videos/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        const renderingIds = Array.isArray(result?.ids)
          ? result.ids.join(", #")
          : null;
        setDeleteMessage({
          tone: "danger",
          text:
            res.status === 409 && renderingIds
              ? `Không thể xóa video đang render: #${renderingIds}.`
              : `Xóa thất bại: ${result?.error ?? res.statusText}`,
        });
        return;
      }
      const cleanupWarnings = Array.isArray(result?.cleanupWarnings)
        ? result.cleanupWarnings
        : [];
      const warningIds = cleanupWarnings
        .map((warning: { id?: unknown }) => Number(warning.id))
        .filter((id: number) => Number.isSafeInteger(id))
        .map((id: number) => `#${id}`)
        .join(", ");
      setSelected(new Set());
      setDeleteMessage({
        tone: cleanupWarnings.length > 0 ? "warning" : "success",
        text:
          cleanupWarnings.length > 0
            ? `Đã xóa ${result?.deleted ?? 0} video khỏi DB, nhưng chưa dọn được artifact của ${warningIds || `${cleanupWarnings.length} video`}.`
            : `Đã xóa ${result?.deleted ?? 0} video và artifact liên quan.`,
      });
      startTransition(() => router.refresh());
    } finally {
      setIsDeleting(false);
    }
  }

  const busy = isDeleting || isPending;

  return (
    <>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-2.5">
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

      {deleteMessage && (
        <p
          className={[
            "rounded-lg px-3 py-2 text-[13px]",
            deleteMessage.tone === "danger"
              ? "bg-[var(--danger-soft)] text-[var(--danger)]"
              : deleteMessage.tone === "warning"
                ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                : "bg-[var(--success-soft)] text-[var(--success)]",
          ].join(" ")}
        >
          {deleteMessage.text}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)]">
        <Table className="min-w-[1180px]">
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
              <TableHead className="w-28 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                Render
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
                    <TtsStatusBadge status={video.ttsStatus} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <RenderStatusBadge
                        audioUrl={video.audioUrl}
                        ttsText={video.ttsText}
                        renderStatus={video.renderStatus}
                        renderAttemptCount={video.renderAttemptCount}
                        renderNextAttemptAt={video.renderNextAttemptAt}
                        outputAvailable={video.outputAvailable}
                        outputCurrent={video.outputCurrent}
                      />
                      {video.outputAvailable && (
                        <a
                          href={`/api/videos/${video.id}/render/file?download=1`}
                          onClick={(event) => event.stopPropagation()}
                          title="Tải video"
                          aria-label={`Tải video #${video.id}`}
                          className="text-[var(--text-muted)] transition-colors hover:text-[var(--accent-cyan)]"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      )}
                      {video.subtitleAvailable && (
                        <a
                          href={`/api/videos/${video.id}/render/subtitles`}
                          onClick={(event) => event.stopPropagation()}
                          title="Tải phụ đề SRT"
                          aria-label={`Tải phụ đề SRT video #${video.id}`}
                          className="text-[var(--text-muted)] transition-colors hover:text-[var(--accent-cyan)]"
                        >
                          <Captions className="h-4 w-4" />
                        </a>
                      )}
                    </div>
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
                  colSpan={9}
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
