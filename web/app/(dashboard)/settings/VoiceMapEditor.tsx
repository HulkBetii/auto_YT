"use client";
import { Trash2, Plus, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { FIXED_PERSONA_NAME, FIXED_PERSONA_VOICE_ID } from "@/lib/ui/fixedPersona";

type Entry = { personaKey: string; voiceId: string };
function parseMap(raw: string): Entry[] {
  try {
    const obj = JSON.parse(raw || "{}");
    if (typeof obj !== "object" || Array.isArray(obj)) return [];
    return Object.entries(obj).map(([personaKey, voiceId]) => ({
      personaKey,
      voiceId: String(voiceId),
    }));
  } catch {
    return [];
  }
}
function serialize(entries: Entry[]): string {
  const obj = Object.fromEntries(entries.map((e) => [e.personaKey, e.voiceId]));
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
  function deleteEntry(personaKey: string) {
    const next = entries.filter((e) => e.personaKey !== personaKey);
    setEntries(next);
    startTransition(async () => {
      const err = await saveToApi(serialize(next));
      if (err) {
        setError(err);
        return;
      }
      setError(null);
      router.refresh();
    });
  }
  function addEntry() {
    const char = newChar.trim();
    const voice = newVoice.trim();
    if (!char || !voice) return;
    if (entries.some((e) => e.personaKey === char)) {
      setError(`"${char}" đã tồn tại trong bản đồ.`);
      return;
    }
    const next = [...entries, { personaKey: char, voiceId: voice }];
    setEntries(next);
    setNewChar("");
    setNewVoice("");
    setError(null);
    startTransition(async () => {
      const err = await saveToApi(serialize(next));
      if (err) {
        setError(err);
        return;
      }
      flashSaved(`${char}__add`);
      router.refresh();
    });
  }
  return (
    <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
      <CardContent className="p-5 flex flex-col gap-4">
        {/* Header */}
        <div>
          <p className="text-[17px] font-semibold text-[var(--text-primary)] ">
            Giọng TTS cố định
          </p>
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
            Pipeline dùng fixed persona {FIXED_PERSONA_NAME}. Thêm key{" "}
            {FIXED_PERSONA_NAME} hoặc Miwa Akihiro trỏ tới{" "}
            {FIXED_PERSONA_VOICE_ID}; nếu thiếu mapping, TTS sẽ được skip.
          </p>
        </div>
        {/* Table header */}
        {entries.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] ">
            <div className="grid grid-cols-[1fr_1fr_36px] bg-[var(--dashboard-bg)] px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                Persona key
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
                Clone Voice ID
              </span>
              <span />
            </div>
            <div className="divide-y divide-[var(--border-subtle)] ">
              {entries.map((entry) => (
                <div
                  key={entry.personaKey}
                  className="grid grid-cols-[1fr_1fr_36px] items-center px-3 py-2.5 hover:bg-[var(--surface-muted)]"
                >
                  <span className="text-[15px] text-[var(--text-primary)] truncate pr-3">
                    {entry.personaKey}
                  </span>
                  <span className="font-mono text-[13px] text-[var(--text-muted)] truncate pr-3">
                    {entry.voiceId}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isPending}
                    className="h-7 w-7 text-[var(--text-secondary)] hover:text-[var(--danger)]"
                    onClick={() => deleteEntry(entry.personaKey)}
                    title="Xóa"
                  >
                    {savedId === `${entry.personaKey}__del` ? (
                      <Check className="h-3.5 w-3.5 text-[var(--success)]" />
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
          <p className="rounded-lg border border-dashed border-[var(--border-subtle)] py-6 text-center text-[15px] text-[var(--text-secondary)] ">
            Chưa có mapping cho {FIXED_PERSONA_NAME}. Thêm key cố định bên dưới.
          </p>
        )}
        {/* Add new row */}
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
            THÊM MAPPING
          </p>
          <div className="flex gap-2">
            <Input
              value={newChar}
              onChange={(e) => {
                setNewChar(e.target.value);
                setError(null);
              }}
              placeholder={FIXED_PERSONA_NAME}
              className="flex-1 text-[15px]"
              onKeyDown={(e) => e.key === "Enter" && addEntry()}
            />
            <Input
              value={newVoice}
              onChange={(e) => {
                setNewVoice(e.target.value);
                setError(null);
              }}
              placeholder={FIXED_PERSONA_VOICE_ID}
              className="w-40 font-mono text-[13px]"
              onKeyDown={(e) => e.key === "Enter" && addEntry()}
            />
            <Button
              onClick={addEntry}
              disabled={!newChar.trim() || !newVoice.trim() || isPending}
              className="gap-1.5 bg-[var(--accent-cyan)] text-[var(--dashboard-bg)] hover:bg-[var(--accent-cyan-hover)] disabled:opacity-50 shrink-0"
            >
              <Plus className="h-4 w-4" /> Thêm
            </Button>
          </div>
        </div>
        {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
        {savedId?.endsWith("__add") && (
          <p className="text-[13px] text-[var(--success)]">Đã thêm và lưu.</p>
        )}
      </CardContent>
    </Card>
  );
}
