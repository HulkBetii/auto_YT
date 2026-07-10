"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
export function ActivateButton({
  promptKey,
  versionId,
}: {
  promptKey: string;
  versionId: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/prompts/${promptKey}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? "Kích hoạt thất bại.");
        return;
      }
      router.refresh();
    });
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        onClick={onClick}
        disabled={isPending}
        className="rounded bg-[var(--accent-cyan)] px-3 py-1 text-xs font-medium text-[var(--dashboard-bg)] hover:bg-[var(--accent-cyan-hover)] disabled:opacity-50 "
      >
        {isPending ? "Đang kích hoạt…" : "Kích hoạt phiên bản này"}
      </button>
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </span>
  );
}
