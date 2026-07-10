"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function onClick() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-7 gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-[var(--success)]" /> Copied
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" /> Copy
        </>
      )}
    </Button>
  );
}
