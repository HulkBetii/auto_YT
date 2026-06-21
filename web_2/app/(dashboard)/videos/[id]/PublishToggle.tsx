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
        body: JSON.stringify({ published, youtubeUrl: published ? url.trim() : "" }),
      });
      if (!res.ok) {
        console.error("[PublishToggle] failed", await res.text().catch(() => ""));
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.10] dark:bg-[#1C1C1E]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-[#FF3B30]" />
          <span className="text-[13px] font-semibold uppercase tracking-wide text-[#6E6E73] dark:text-[#AEAEB2]">
            Publish
          </span>
        </div>
        {isPublished && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#D1F2D1] px-2.5 py-1 text-[11px] font-medium text-[#1A7A1A]">
            <CheckCircle2 className="h-3 w-3" />
            Published
          </span>
        )}
      </div>

      <div className="mt-3 space-y-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://youtu.be/…  (YouTube link)"
          className="w-full rounded-lg border border-black/[.10] bg-[#F2F2F7] px-3 py-2 text-[14px] text-[#1C1C1E] outline-none placeholder:text-[#AEAEB2] focus:border-[#007AFF] dark:border-white/[.10] dark:bg-[#2C2C2E] dark:text-white"
        />

        <div className="flex items-center gap-2">
          {!isPublished ? (
            <button
              onClick={() => send(true)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#34C759]/10 px-3 py-1.5 text-[12px] font-medium text-[#1A7A1A] transition-colors hover:bg-[#34C759]/20 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {loading ? "Saving…" : "Mark as published"}
            </button>
          ) : (
            <>
              <button
                onClick={() => send(true)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#007AFF]/10 px-3 py-1.5 text-[12px] font-medium text-[#007AFF] transition-colors hover:bg-[#007AFF]/20 disabled:opacity-50"
              >
                {loading ? "Saving…" : "Update link"}
              </button>
              <button
                onClick={() => send(false)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#FF3B30]/10 px-3 py-1.5 text-[12px] font-medium text-[#FF3B30] transition-colors hover:bg-[#FF3B30]/20 disabled:opacity-50"
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
              className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-[#007AFF] hover:underline"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
