"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function CreateVideoForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const result = (await response.json()) as { ok: boolean; videoId?: number; error?: string };
      if (!response.ok || !result.ok || !result.videoId) throw new Error(result.error ?? "Không thể tạo project.");
      router.push(`/videos/${result.videoId}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="paper-card reveal overflow-hidden">
      <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-end md:p-8">
        <label>
          <span className="eyebrow mb-2 block">Video nguồn</span>
          <span className="display mb-4 block text-3xl font-bold">Bắt đầu từ một đường link YouTube</span>
          <input className="field h-13 px-4 text-sm" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
        </label>
        <button className="button-primary h-13 px-7" disabled={submitting}>{submitting ? "Đang gửi..." : "Tạo kịch bản"}</button>
      </div>
      {error ? <p className="border-t border-[var(--line)] bg-red-900/5 px-6 py-3 text-sm font-bold text-[var(--seal-dark)]">{error}</p> : null}
    </form>
  );
}
