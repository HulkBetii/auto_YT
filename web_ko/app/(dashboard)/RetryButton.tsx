"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RetryButton({ videoId }: { videoId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function retry() {
    setBusy(true); setError(null);
    const response = await fetch(`/api/videos/${videoId}/retry`, { method: "POST" });
    const result = (await response.json()) as { ok: boolean; error?: string };
    if (!response.ok || !result.ok) setError(result.error ?? "Retry failed.");
    router.refresh(); setBusy(false);
  }
  return <div className="flex flex-wrap items-center gap-3"><button className="button-danger" disabled={busy} onClick={retry}>{busy ? "Đang thử lại..." : "Thử lại giai đoạn lỗi"}</button>{error ? <span className="text-xs font-bold text-[var(--seal-dark)]">{error}</span> : null}</div>;
}
