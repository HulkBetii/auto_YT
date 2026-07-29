"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function StudyApiKeyField({
  fieldKey,
  configured,
}: {
  fieldKey: string;
  configured: boolean;
}) {
  const [value, setValue] = useState("");
  const [isConfigured, setIsConfigured] = useState(configured);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      setError("Enter an API key before saving.");
      return;
    }

    setIsSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [fieldKey]: trimmedValue }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error ?? "Save failed.");
        return;
      }

      // Clear the secret from the input after saving; only the configured state remains.
      setValue("");
      setIsConfigured(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Cannot connect to server.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
      <label className="block">
        <span className="text-[13px] font-medium">Study AI33.PRO API Key</span>
        <span className="ml-2 text-[12px] text-[var(--text-secondary)]">
          Used for weekly Study music generation; the key is never displayed.
        </span>
        <div className="mt-2 flex gap-2">
          <input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={
              isConfigured
                ? "Configured - enter a new key to replace"
                : "Paste AI33.PRO API key"
            }
            autoComplete="new-password"
            spellCheck={false}
            className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3 py-1.5 text-[14px] text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent-cyan)]/30"
          />
          <Button
            onClick={onSave}
            disabled={isSaving || value.trim().length === 0}
            size="sm"
            className="bg-[var(--accent-cyan)] text-[var(--dashboard-bg)] hover:bg-[var(--accent-cyan-hover)] disabled:opacity-50"
          >
            {isSaving ? "Saving..." : saved ? "Saved" : "Save"}
          </Button>
        </div>
      </label>
      <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
        <span
          className={`inline-block h-2 w-2 rounded-full ${isConfigured ? "bg-emerald-400" : "bg-[var(--text-secondary)]"}`}
          aria-hidden="true"
        />
        <span>{isConfigured ? "API key configured" : "API key not configured"}</span>
      </div>
      {error && <p className="mt-1 text-[12px] text-[var(--danger)]">{error}</p>}
    </div>
  );
}
