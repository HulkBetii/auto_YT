"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function RetryButton({ jobId }: { jobId: number }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  async function handleRetry() {
    setLoading(true);
    try {
      await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }
  return (
    <button
      onClick={handleRetry}
      disabled={loading}
      className="rounded px-2 py-0.5 text-[11px] font-medium bg-[var(--warning-soft)] text-[var(--warning)] hover:bg-[var(--warning-soft)] disabled:opacity-50 transition-colors"
    >
      {loading ? "…" : "Retry"}
    </button>
  );
}
