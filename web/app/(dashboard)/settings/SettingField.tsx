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
    <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
      <CardContent className="p-5">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div>
            <p className="text-[15px] font-medium text-[var(--text-primary)] ">
              {label}
            </p>
            <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
              {description}
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSaved(false);
              }}
              className="flex-1 text-[15px]"
            />
            <Button
              type="submit"
              disabled={isPending || value === initialValue}
              className="shrink-0 bg-[var(--accent-cyan)] text-[var(--dashboard-bg)] hover:bg-[var(--accent-cyan-hover)] disabled:opacity-50"
            >
              {isPending ? "Đang lưu…" : "Lưu"}
            </Button>
          </div>
          {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
          {saved && !error && (
            <p className="text-[13px] text-[var(--success)]">Đã lưu.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
