"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CreateVideoButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch("/api/videos/create", { method: "POST" });
      const json = (await res.json().catch(() => null)) as { ok: boolean; episodeId?: number; error?: string } | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Failed to create episode.");
        return;
      }
      router.push(`/videos/${json.episodeId}`);
      router.refresh();
    } catch {
      setError("Cannot connect to server.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={onClick}
        disabled={isLoading}
        size="sm"
        className="gap-1.5 bg-[#34C759] text-white hover:bg-[#28A244] disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        {isLoading ? "Creating…" : "New episode"}
      </Button>
      {error && <span className="text-[13px] text-[#FF3B30]">{error}</span>}
    </div>
  );
}
