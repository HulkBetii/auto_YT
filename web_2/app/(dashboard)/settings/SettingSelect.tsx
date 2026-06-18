"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SettingSelect({
  fieldKey,
  label,
  description,
  initialValue,
  options,
}: {
  fieldKey: string;
  label: string;
  description?: string;
  initialValue: string;
  options: readonly { value: string; label: string }[];
}) {
  const fallbackValue = options[0]?.value ?? "";
  const [value, setValue] = useState(
    options.some((option) => option.value === initialValue) ? initialValue : fallbackValue,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setIsSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [fieldKey]: value }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Save failed.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Cannot connect to server.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.10] dark:bg-[#1C1C1E]">
      <label className="block">
        <span className="text-[13px] font-medium text-[#1C1C1E] dark:text-white">{label}</span>
        {description && (
          <span className="ml-2 text-[12px] text-[#AEAEB2]">{description}</span>
        )}
        <div className="mt-2 flex gap-2">
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1 rounded-lg border border-black/[.08] bg-[#F2F2F7] px-3 py-1.5 text-[14px] text-[#1C1C1E] outline-none focus:ring-2 focus:ring-[#007AFF]/30 dark:border-white/[.10] dark:bg-[#2C2C2E] dark:text-white"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button
            onClick={onSave}
            disabled={isSaving}
            size="sm"
            className="bg-[#007AFF] text-white hover:bg-[#0062CC] disabled:opacity-50"
          >
            {isSaving ? "Saving..." : saved ? "Saved" : "Save"}
          </Button>
        </div>
      </label>
      {error && <p className="mt-1 text-[12px] text-[#FF3B30]">{error}</p>}
    </div>
  );
}
