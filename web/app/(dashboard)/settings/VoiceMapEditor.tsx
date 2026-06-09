"use client";

import { Trash2, Plus, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

type Entry = { character: string; voiceId: string };

function parseMap(raw: string): Entry[] {
  try {
    const obj = JSON.parse(raw || "{}");
    if (typeof obj !== "object" || Array.isArray(obj)) return [];
    return Object.entries(obj).map(([character, voiceId]) => ({
      character,
      voiceId: String(voiceId),
    }));
  } catch {
    return [];
  }
}

function serialize(entries: Entry[]): string {
  const obj = Object.fromEntries(entries.map((e) => [e.character, e.voiceId]));
  return JSON.stringify(obj);
}

async function saveToApi(value: string): Promise<string | null> {
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "tts_voice_map", value }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    return json?.error ?? "Lưu thất bại.";
  }
  return null;
}

export function VoiceMapEditor({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>(() => parseMap(initialValue));
  const [newChar, setNewChar] = useState("");
  const [newVoice, setNewVoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function flashSaved(key: string) {
    setSavedId(key);
    setTimeout(() => setSavedId(null), 1500);
  }

  function deleteEntry(character: string) {
    const next = entries.filter((e) => e.character !== character);
    setEntries(next);
    startTransition(async () => {
      const err = await saveToApi(serialize(next));
      if (err) { setError(err); return; }
      setError(null);
      router.refresh();
    });
  }

  function addEntry() {
    const char = newChar.trim();
    const voice = newVoice.trim();
    if (!char || !voice) return;
    if (entries.some((e) => e.character === char)) {
      setError(`"${char}" đã tồn tại trong bản đồ.`);
      return;
    }
    const next = [...entries, { character: char, voiceId: voice }];
    setEntries(next);
    setNewChar("");
    setNewVoice("");
    setError(null);
    startTransition(async () => {
      const err = await saveToApi(serialize(next));
      if (err) { setError(err); return; }
      flashSaved(`${char}__add`);
      router.refresh();
    });
  }

  return (
    <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
      <CardContent className="p-5 flex flex-col gap-4">
        {/* Header */}
        <div>
          <p className="text-[17px] font-semibold text-[#1C1C1E] dark:text-white">
            Bản đồ giọng TTS
          </p>
          <p className="mt-0.5 text-[13px] text-[#6E6E73]">
            Ánh xạ tên nhân vật sang Clone Voice ID của AI33.PRO. Khớp không phân biệt hoa thường.
          </p>
        </div>

        {/* Table header */}
        {entries.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-black/[.06] dark:border-white/[.08]">
            <div className="grid grid-cols-[1fr_1fr_36px] bg-[#F2F2F7] dark:bg-white/[.04] px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Nhân vật</span>
              <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">Clone Voice ID</span>
              <span />
            </div>
            <div className="divide-y divide-black/[.06] dark:divide-white/[.08]">
              {entries.map((entry) => (
                <div
                  key={entry.character}
                  className="grid grid-cols-[1fr_1fr_36px] items-center px-3 py-2.5 hover:bg-black/[.02] dark:hover:bg-white/[.03]"
                >
                  <span className="text-[15px] text-[#1C1C1E] dark:text-white truncate pr-3">
                    {entry.character}
                  </span>
                  <span className="font-mono text-[13px] text-[#6E6E73] truncate pr-3">
                    {entry.voiceId}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isPending}
                    className="h-7 w-7 text-[#AEAEB2] hover:text-[#FF3B30]"
                    onClick={() => deleteEntry(entry.character)}
                    title="Xóa"
                  >
                    {savedId === `${entry.character}__del` ? (
                      <Check className="h-3.5 w-3.5 text-[#34C759]" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {entries.length === 0 && (
          <p className="rounded-lg border border-dashed border-black/[.08] py-6 text-center text-[15px] text-[#AEAEB2] dark:border-white/[.10]">
            Chưa có mapping nào. Thêm mới bên dưới.
          </p>
        )}

        {/* Add new row */}
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
            THÊM MAPPING MỚI
          </p>
          <div className="flex gap-2">
            <Input
              value={newChar}
              onChange={(e) => { setNewChar(e.target.value); setError(null); }}
              placeholder="Tên nhân vật (vd: 松下幸之助)"
              className="flex-1 text-[15px]"
              onKeyDown={(e) => e.key === "Enter" && addEntry()}
            />
            <Input
              value={newVoice}
              onChange={(e) => { setNewVoice(e.target.value); setError(null); }}
              placeholder="clone_XXXXXXX"
              className="w-40 font-mono text-[13px]"
              onKeyDown={(e) => e.key === "Enter" && addEntry()}
            />
            <Button
              onClick={addEntry}
              disabled={!newChar.trim() || !newVoice.trim() || isPending}
              className="gap-1.5 bg-[#007AFF] text-white hover:bg-[#0062CC] disabled:opacity-50 shrink-0"
            >
              <Plus className="h-4 w-4" />
              Thêm
            </Button>
          </div>
        </div>

        {error && <p className="text-[13px] text-[#FF3B30]">{error}</p>}
        {savedId?.endsWith("__add") && (
          <p className="text-[13px] text-[#34C759]">Đã thêm và lưu.</p>
        )}
      </CardContent>
    </Card>
  );
}
