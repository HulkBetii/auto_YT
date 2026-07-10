"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
export function UnpauseButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  function onClick() {
    startTransition(async () => {
      await fetch("/api/settings/unpause", { method: "POST" });
      router.refresh();
    });
  }
  return (
    <button
      onClick={onClick}
      disabled={isPending}
      className="rounded bg-[var(--warning)] px-3 py-1 text-xs font-medium text-[var(--dashboard-bg)] hover:bg-[var(--warning)] disabled:opacity-50"
    >
      {isPending ? "Đang tiếp tục…" : "Tiếp tục tự động cập nhật"}
    </button>
  );
}
