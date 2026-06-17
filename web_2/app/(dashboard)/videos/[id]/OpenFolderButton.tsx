"use client";

import { FolderOpen, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function OpenFolderButton({ filePath }: { filePath: string }) {
  const [state, setState] = useState<"idle" | "copied">("idle");

  const folderPath = filePath.includes("/")
    ? filePath.substring(0, filePath.lastIndexOf("/"))
    : filePath;

  async function onClick() {
    await navigator.clipboard.writeText(`open "${folderPath}"`);
    setState("copied");
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={onClick}
        className="h-7 gap-1.5 text-[12px] text-[#6E6E73] hover:text-[#1C1C1E] dark:hover:text-white transition-colors duration-150"
      >
        {state === "copied" ? (
          <>
            <Check className="h-3.5 w-3.5 text-[#34C759]" />
            <span className="text-[#34C759]">Copied!</span>
          </>
        ) : (
          <>
            <FolderOpen className="h-3.5 w-3.5" />
            Open in Folder
          </>
        )}
      </Button>
      {state === "copied" && (
        <p className="absolute right-0 top-8 z-10 whitespace-nowrap rounded-md bg-[#1C1C1E] px-2.5 py-1.5 text-[11px] text-white dark:bg-white dark:text-[#1C1C1E]">
          Paste in Terminal to open Finder
        </p>
      )}
    </div>
  );
}
