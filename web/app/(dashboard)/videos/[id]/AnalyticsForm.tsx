"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Manual CTR + AVD entry form for published videos.
 *
 * YouTube Data API (API key) fetches views/likes/comments automatically via
 * the check-analytics cron. But CTR and AVD require YouTube Analytics OAuth —
 * so the operator copies them from YouTube Studio and enters them here.
 * Once both are entered AND views >= threshold, P5 triggers automatically
 * on the next check-analytics run.
 */
export function AnalyticsForm({
  videoId,
  currentCtrPct,
  currentAvdMinutes,
}: {
  videoId: number;
  currentCtrPct: number | null;
  currentAvdMinutes: number | null;
}) {
  const router = useRouter();
  const [ctr, setCtr] = useState(currentCtrPct != null ? String(currentCtrPct) : "");
  const [avd, setAvd] = useState(currentAvdMinutes != null ? String(currentAvdMinutes) : "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const ctrNum = Number.parseFloat(ctr);
    const avdNum = Number.parseFloat(avd);
    if (!Number.isFinite(ctrNum) || ctrNum < 0 || ctrNum > 100) {
      setError("CTR phải là số từ 0–100.");
      return;
    }
    if (!Number.isFinite(avdNum) || avdNum < 0) {
      setError("AVD phải là số dương (phút).");
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/videos/${videoId}/analytics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ctrPct: ctrNum, avdMinutes: avdNum }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Lưu thất bại.");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">
        Sao chép từ YouTube Studio Analytics. Khi đủ lượt xem + có CTR/AVD, P5 tự động kích hoạt.
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
          CTR (%)
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={ctr}
            onChange={(e) => setCtr(e.target.value)}
            placeholder="vd: 4.25"
            className="w-32 rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
          AVD (phút)
          <input
            type="number"
            step="0.1"
            min="0"
            value={avd}
            onChange={(e) => setAvd(e.target.value)}
            placeholder="vd: 3.5"
            className="w-32 rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={isPending || !ctr || !avd}
            className="rounded bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? "Đang lưu…" : "Lưu"}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-emerald-600">✓ Đã lưu. P5 sẽ tự kích hoạt khi đủ lượt xem.</p>}
    </form>
  );
}
