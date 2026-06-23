"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EpisodeTrackAudio } from "@/lib/db/schema";

function fmt(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  return sec < 60 ? `${Math.round(sec)}s` : `${(sec / 60).toFixed(1)}m`;
}

export function TrackClips({
  episodeId,
  specIndex,
  track,
}: {
  episodeId: number;
  specIndex: number;
  track: EpisodeTrackAudio;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const primary = track.primaryClipIndex ?? 0;

  async function setPrimary(clipIndex: number) {
    setBusy(true);
    try {
      await fetch(`/api/videos/${episodeId}/tracks/${specIndex}/primary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipIndex }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {track.clips.map((clip, ci) => {
        const isPrimary = ci === primary;
        return (
          <div key={ci} className="flex items-center gap-2">
            <audio controls preload="none" src={clip.url} className="h-8 w-full max-w-md" />
            <span className="shrink-0 text-[12px] text-[#AEAEB2]">{fmt(clip.durationSec)}</span>
            {isPrimary ? (
              <span className="shrink-0 rounded px-2 py-0.5 text-[10px] font-medium bg-[#D1F2D1] text-[#1A7A1A]">
                primary
              </span>
            ) : (
              <button
                onClick={() => setPrimary(ci)}
                disabled={busy}
                className="shrink-0 rounded px-2 py-0.5 text-[10px] font-medium text-[#007AFF] hover:bg-[#007AFF]/10 disabled:opacity-50"
              >
                set primary
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
