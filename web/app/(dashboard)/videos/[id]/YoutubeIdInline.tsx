"use client";

import { Pencil, X, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function YoutubeIdInline({
  videoId,
  currentValue,
}: {
  videoId: number;
  currentValue: string | null | undefined;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSave() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/videos/${videoId}/youtube-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeVideoId: value }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Lưu thất bại.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="vd: dQw4w9WgXcQ"
            className="h-8 text-[13px]"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && value) onSave();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 text-[#34C759] hover:text-[#34C759]"
            disabled={!value || isPending}
            onClick={onSave}
          >
            <Check className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => setEditing(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {error && <p className="text-[12px] text-[#FF3B30]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[15px] text-[#1C1C1E] dark:text-white">
        {currentValue ?? "—"}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="ml-auto h-7 w-7 shrink-0 text-[#AEAEB2] hover:text-[#1C1C1E] dark:hover:text-white"
        onClick={() => setEditing(true)}
        title="Chỉnh sửa YouTube ID"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
