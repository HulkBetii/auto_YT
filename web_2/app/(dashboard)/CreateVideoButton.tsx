"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function CreateVideoButton({ promptSets }: { promptSets: string[] }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptSetVersion, setPromptSetVersion] = useState(promptSets[0] ?? "current");

  async function onClick() {
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch("/api/videos/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptSetVersion }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok: boolean;
        videoId?: number;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Failed to create video.");
        return;
      }
      router.push(`/videos/${json.videoId}`);
      router.refresh();
    } catch {
      setError("Cannot connect to server.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <label className="whitespace-nowrap text-[12px] text-[var(--text-secondary)]">
          Prompt set
        </label>
        <select
          value={promptSetVersion}
          onChange={(event) => setPromptSetVersion(event.target.value)}
          disabled={isLoading}
          className="h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] px-2 text-[13px] text-[var(--text-primary)] disabled:opacity-50"
        >
          {promptSets.map((setVersion) => (
            <option key={setVersion} value={setVersion}>
              {setVersion}
            </option>
          ))}
        </select>
        <Button
          onClick={onClick}
          disabled={isLoading}
          size="sm"
          className="gap-1.5 bg-[var(--success)] text-[var(--dashboard-bg)] hover:bg-[var(--success)] disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          {isLoading ? "Creating..." : "New video"}
        </Button>
      </div>
      {error && (
        <span className="text-[13px] text-[var(--danger)]">{error}</span>
      )}
    </div>
  );
}

