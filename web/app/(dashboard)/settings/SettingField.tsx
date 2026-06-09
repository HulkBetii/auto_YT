"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export function SettingField({
  fieldKey,
  label,
  description,
  initialValue,
}: {
  fieldKey: string;
  label: string;
  description: string;
  initialValue: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: fieldKey, value }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? "Lưu thất bại.");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
      <CardContent className="p-5">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div>
            <p className="text-[15px] font-medium text-[#1C1C1E] dark:text-white">{label}</p>
            <p className="mt-0.5 text-[13px] text-[#6E6E73]">{description}</p>
          </div>
          <div className="flex gap-2">
            <Input
              value={value}
              onChange={(e) => { setValue(e.target.value); setSaved(false); }}
              className="flex-1 text-[15px]"
            />
            <Button
              type="submit"
              disabled={isPending || value === initialValue}
              className="shrink-0 bg-[#007AFF] text-white hover:bg-[#0062CC] disabled:opacity-50"
            >
              {isPending ? "Đang lưu…" : "Lưu"}
            </Button>
          </div>
          {error && <p className="text-[13px] text-[#FF3B30]">{error}</p>}
          {saved && !error && <p className="text-[13px] text-[#34C759]">Đã lưu.</p>}
        </form>
      </CardContent>
    </Card>
  );
}
