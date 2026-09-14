"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Card, CardContent } from "@/components/ui/card";

export function BooleanSettingField({
  fieldKey,
  label,
  description,
  initialValue,
}: {
  fieldKey: string;
  label: string;
  description: string;
  initialValue: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const nextValue = !enabled;
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: fieldKey, value: String(nextValue) }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setError(result?.error ?? "Lưu thất bại.");
        return;
      }
      setEnabled(nextValue);
      router.refresh();
    });
  }

  return (
    <Card className="rounded-xl border-[var(--border-subtle)] shadow-none">
      <CardContent className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-[15px] font-medium text-[var(--text-primary)]">
            {label}
          </p>
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
            {description}
          </p>
          {error && <p className="mt-1 text-[13px] text-[var(--danger)]">{error}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={label}
          disabled={isPending}
          onClick={toggle}
          className={[
            "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
            enabled ? "bg-[var(--warning)]" : "bg-[var(--surface-muted)]",
          ].join(" ")}
        >
          <span
            className={[
              "absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform",
              enabled ? "translate-x-5" : "translate-x-0",
            ].join(" ")}
          />
        </button>
      </CardContent>
    </Card>
  );
}
