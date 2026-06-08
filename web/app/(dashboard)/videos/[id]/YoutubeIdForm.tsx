"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function YoutubeIdForm({ videoId, currentValue }: { videoId: number; currentValue: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(currentValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/videos/${videoId}/youtube-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeVideoId: value.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? "Failed to save.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
        YouTube video ID (the only required manual step post-publish)
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. dQw4w9WgXcQ"
            className="flex-1 rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={isPending || value.trim().length === 0}
            className="rounded bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
