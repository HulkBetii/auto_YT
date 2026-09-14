"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PromptEditor({ promptKey, template, version }: { promptKey: "source_audit" | "outline" | "section" | "fidelity_review"; template: string; version: number }) {
  const router = useRouter();
  const [value, setValue] = useState(template);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(null); const response = await fetch("/api/prompts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptKey, template: value, changeReason: reason }) }); const result = (await response.json()) as { ok: boolean; error?: string }; setMessage(result.ok ? "Đã tạo phiên bản prompt mới." : result.error ?? "Lưu thất bại."); if (result.ok) { setReason(""); router.refresh(); } setBusy(false); }
  return <form onSubmit={save} className="paper-card p-5 md:p-7"><div className="mb-4 flex items-end justify-between gap-3"><div><p className="eyebrow">{promptKey}</p><h2 className="display text-2xl font-bold">Phiên bản {version}</h2></div><button className="button-primary" disabled={busy}>{busy ? "Đang lưu..." : "Kích hoạt bản mới"}</button></div><textarea className="field min-h-[34rem] p-4 font-mono text-xs leading-6" value={value} onChange={(event) => setValue(event.target.value)} /><input className="field mt-3 h-11 px-4 text-sm" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Lý do thay đổi (không bắt buộc)" />{message ? <p className="mt-3 text-xs font-bold">{message}</p> : null}</form>;
}
