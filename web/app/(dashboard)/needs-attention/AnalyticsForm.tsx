"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
export function AnalyticsForm({ videoId }: { videoId: number }) {
  const router = useRouter();
  const [ctrPct, setCtrPct] = useState("");
  const [avdMinutes, setAvdMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const ctr = Number.parseFloat(ctrPct);
    const avd = Number.parseFloat(avdMinutes);
    if (!Number.isFinite(ctr) || !Number.isFinite(avd)) {
      setError("Hãy nhập giá trị số cho cả hai trường.");
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/videos/${videoId}/analytics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ctrPct: ctr, avdMinutes: avd }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? "Lưu thất bại.");
        return;
      }
      router.refresh();
    });
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
        CTR (%)
        <input
          value={ctrPct}
          onChange={(e) => setCtrPct(e.target.value)}
          inputMode="decimal"
          placeholder="vd: 6.50"
          className="w-24 rounded border border-[var(--border-strong)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-cyan)] "
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
        Thời lượng xem TB (phút)
        <input
          value={avdMinutes}
          onChange={(e) => setAvdMinutes(e.target.value)}
          inputMode="decimal"
          placeholder="vd: 4.2"
          className="w-32 rounded border border-[var(--border-strong)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-cyan)] "
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-[var(--accent-cyan)] px-3 py-1.5 text-xs font-medium text-[var(--dashboard-bg)] hover:bg-[var(--accent-cyan-hover)] disabled:opacity-50 "
      >
        {isPending ? "Đang lưu…" : "Lưu"}
      </button>
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </form>
  );
}
