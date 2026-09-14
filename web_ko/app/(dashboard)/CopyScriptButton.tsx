"use client";

import { useState } from "react";

export function CopyScriptButton({ script }: { script: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="button-secondary" onClick={async () => { await navigator.clipboard.writeText(script); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}>{copied ? "Đã sao chép" : "Sao chép TXT"}</button>;
}
