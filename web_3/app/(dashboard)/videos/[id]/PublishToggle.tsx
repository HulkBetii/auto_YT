"use client";
import { CheckCircle2, ExternalLink, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
export function PublishToggle({
  videoId,
  publishedAt,
  youtubeUrl,
}: {
  videoId: number;
  publishedAt: string | null;
  youtubeUrl: string | null;
}) {
  const router = useRouter();
  const isPublished = Boolean(publishedAt);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState(youtubeUrl ?? "");
  async function send(published: boolean) {
    setLoading(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          published,
          youtubeUrl: published ? url.trim() : "",
        }),
      });
      if (!res.ok) {
        console.error(
          "[PublishToggle] failed",
          await res.text().catch(() => ""),
        );
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-[var(--danger)]" />
          <span className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Publish
          </span>
        </div>
        {isPublished && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--success)]">
            <CheckCircle2 className="h-3 w-3" /> Published
          </span>
        )}
      </div>
      <div className="mt-3 space-y-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://youtu.be/… (YouTube link)"
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3 py-2 text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-cyan)]"
        />
        <div className="flex items-center gap-2">
          {!isPublished ? (
            <button
              onClick={() => send(true)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--success-soft)] px-3 py-1.5 text-[12px] font-medium text-[var(--success)] transition-colors hover:bg-[var(--success)]/20 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {loading ? "Saving…" : "Mark as published"}
            </button>
          ) : (
            <>
              <button
                onClick={() => send(true)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-cyan)]/10 px-3 py-1.5 text-[12px] font-medium text-[var(--accent-cyan)] transition-colors hover:bg-[var(--accent-cyan)]/20 disabled:opacity-50"
              >
                {loading ? "Saving…" : "Update link"}
              </button>
              <button
                onClick={() => send(false)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--danger)]/10 px-3 py-1.5 text-[12px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/20 disabled:opacity-50"
              >
                Unmark
              </button>
            </>
          )}
          {isPublished && youtubeUrl && (
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent-cyan)] hover:underline"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
