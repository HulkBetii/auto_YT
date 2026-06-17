"use client";

import { AlertCircle, Check, FolderOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function OpenFolderButton({ filePath }: { filePath: string }) {
  const [state, setState] = useState<"idle" | "opening" | "opened" | "error">("idle");

  function resetState() {
    setTimeout(() => setState("idle"), 2500);
  }

  async function onClick() {
    setState("opening");
    try {
      const response = await fetch("/api/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
      if (response.ok) {
        setState("opened");
        resetState();
        return;
      }
      setState("error");
      resetState();
    } catch {
      setState("error");
      resetState();
    }
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={onClick}
        disabled={state === "opening"}
        title="Open video folder"
        className="h-7 gap-1.5 text-[12px] text-[#6E6E73] hover:text-[#1C1C1E] dark:hover:text-white transition-colors duration-150"
      >
        {state === "opening" ? (
          <>
            <FolderOpen className="h-3.5 w-3.5" />
            Opening...
          </>
        ) : state === "opened" ? (
          <>
            <Check className="h-3.5 w-3.5 text-[#34C759]" />
            <span className="text-[#34C759]">Opened</span>
          </>
        ) : state === "error" ? (
          <>
            <AlertCircle className="h-3.5 w-3.5 text-[#FF453A]" />
            <span className="text-[#FF453A]">Open failed</span>
          </>
        ) : (
          <>
            <FolderOpen className="h-3.5 w-3.5" />
            Open in Folder
          </>
        )}
      </Button>
    </div>
  );
}
