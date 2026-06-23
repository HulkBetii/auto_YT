"use client";

import { RefreshCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RetryVideoButton({ videoId }: { videoId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRetry() {
    setLoading(true);
    try {
      const response = await fetch(`/api/videos/${videoId}/retry`, { method: "POST" });
      if (!response.ok) {
        console.error("[RetryVideoButton] retry failed", await response.text().catch(() => ""));
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleRetry}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md bg-[#FF9F0A]/10 px-3 py-1.5 text-[12px] font-medium text-[#FF9F0A] transition-colors hover:bg-[#FF9F0A]/20 disabled:opacity-50"
      title="Retry this video from the failed or next resumable stage"
    >
      <RefreshCcw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
      {loading ? "Retrying..." : "Retry video"}
    </button>
  );
}
