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
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        CTR (%)
        <input
          value={ctrPct}
          onChange={(e) => setCtrPct(e.target.value)}
          inputMode="decimal"
          placeholder="vd: 6.50"
          className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Thời lượng xem TB (phút)
        <input
          value={avdMinutes}
          onChange={(e) => setAvdMinutes(e.target.value)}
          inputMode="decimal"
          placeholder="vd: 4.2"
          className="w-32 rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Đang lưu…" : "Lưu"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
