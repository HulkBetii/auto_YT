"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
export function RetryJobButton({ jobId }: { jobId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? "Thử lại thất bại.");
        return;
      }
      router.refresh();
    });
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={isPending}
        className="rounded bg-[var(--accent-cyan)] px-3 py-1 text-xs font-medium text-[var(--dashboard-bg)] hover:bg-[var(--accent-cyan-hover)] disabled:opacity-50 "
      >
        {isPending ? "Đang thử lại…" : "Thử lại"}
      </button>
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </span>
  );
}
