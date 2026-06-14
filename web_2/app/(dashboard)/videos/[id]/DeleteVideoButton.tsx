"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteVideoButton({ videoId }: { videoId: number }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    setLoading(true);
    try {
      await fetch(`/api/videos/${videoId}`, { method: "DELETE" });
      router.push("/videos");
    } finally {
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-[#FF3B30]">Delete this video?</span>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="rounded px-3 py-1 text-[12px] font-medium bg-[#FF3B30] text-white hover:bg-[#D70015] disabled:opacity-50 transition-colors"
        >
          {loading ? "Deleting…" : "Confirm"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded px-3 py-1 text-[12px] font-medium text-[#6E6E73] hover:text-[#1C1C1E] dark:hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded px-3 py-1 text-[12px] font-medium text-[#FF3B30] border border-[#FF3B30]/30 hover:bg-[#FF3B30]/10 transition-colors"
    >
      Delete
    </button>
  );
}
