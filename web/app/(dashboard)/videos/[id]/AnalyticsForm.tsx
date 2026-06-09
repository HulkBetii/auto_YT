"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Manual CTR + AVD entry for published videos.
 * YouTube Data API fetches views automatically; CTR/AVD require Analytics OAuth
 * so the operator enters them manually from YouTube Studio.
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
      <p className="text-[13px] text-[#6E6E73]">
        Sao chép từ YouTube Studio. Khi đủ lượt xem + có CTR/AVD, P5 tự động kích hoạt.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
            CTR (%)
          </span>
          <Input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={ctr}
            onChange={(e) => setCtr(e.target.value)}
            placeholder="4.25"
            className="w-28 text-[15px]"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
            AVD (phút)
          </span>
          <Input
            type="number"
            step="0.1"
            min="0"
            value={avd}
            onChange={(e) => setAvd(e.target.value)}
            placeholder="3.5"
            className="w-28 text-[15px]"
          />
        </label>
        <Button
          type="submit"
          disabled={isPending || !ctr || !avd}
          className="bg-[#007AFF] text-white hover:bg-[#0062CC] disabled:opacity-50"
        >
          {isPending ? "Đang lưu…" : "Lưu"}
        </Button>
      </div>
      {error && <p className="text-[13px] text-[#FF3B30]">{error}</p>}
      {saved && <p className="text-[13px] text-[#34C759]">Đã lưu. P5 sẽ tự kích hoạt khi đủ lượt xem.</p>}
    </form>
  );
}
