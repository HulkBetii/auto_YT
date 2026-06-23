"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

const STAGE_LABELS: Record<string, string> = {
  S1: "Topics — generate 5 candidate topics",
  S2: "Script — write full narration",
  S3: "Image Prompts — one prompt per segment",
  S4: "YouTube Metadata — title, description, tags",
};

interface PromptRow {
  key: string;
  row: {
    id: number;
    version: number;
    template: string;
    changeReason: string | null;
    createdAt: Date | string;
  } | null;
}

export function PromptEditor({ prompts }: { prompts: PromptRow[] }) {
  return (
    <div className="space-y-8">
      {prompts.map(({ key, row }) => (
        <SinglePrompt key={key} promptKey={key} row={row} />
      ))}
    </div>
  );
}

function SinglePrompt({ promptKey, row }: { promptKey: string; row: PromptRow["row"] }) {
  const [template, setTemplate] = useState(row?.template ?? "");
  const [changeReason, setChangeReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDirty = template !== (row?.template ?? "");

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptKey, template, changeReason }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Save failed");
      setSavedVersion(data.version);
      setChangeReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  const currentVersion = savedVersion ?? row?.version ?? 0;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
            {promptKey}
          </span>
          <span className="ml-2 text-[11px] text-[#6E6E73]">— {STAGE_LABELS[promptKey]}</span>
        </div>
        <span className="text-[11px] font-mono text-[#AEAEB2]">v{currentVersion}</span>
      </div>

      <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
        <CardContent className="p-4 space-y-3">
          <textarea
            value={template}
            onChange={(e) => { setTemplate(e.target.value); setSavedVersion(null); }}
            rows={12}
            spellCheck={false}
            className="w-full resize-y rounded-lg border border-black/[.08] bg-[#F2F2F7] px-3 py-2 font-mono text-[12px] leading-relaxed text-[#1C1C1E] outline-none focus:border-[#007AFF] dark:border-white/[.10] dark:bg-black dark:text-white"
          />

          {isDirty && (
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                placeholder="Change reason (optional)"
                className="flex-1 rounded-lg border border-black/[.08] bg-[#F2F2F7] px-3 py-1.5 text-[13px] text-[#1C1C1E] outline-none focus:border-[#007AFF] dark:border-white/[.10] dark:bg-black dark:text-white"
              />
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-[#007AFF] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#0062CC] disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}

          {savedVersion !== null && !isDirty && (
            <p className="text-[12px] text-[#34C759]">Saved as v{savedVersion}</p>
          )}
          {error && <p className="text-[12px] text-[#FF3B30]">{error}</p>}
        </CardContent>
      </Card>
    </section>
  );
}
