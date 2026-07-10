import Link from "next/link";
import { AlertTriangle, Clock, Download, Mic2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  FIXED_PERSONA_NAME,
  FIXED_PERSONA_VOICE_ID,
  formatPersonaName,
  getPersonaUiStatus,
} from "@/lib/ui/fixedPersona";
import { Button } from "@/components/ui/button"; // ── Done: native audio player ──────────────────────────────────────────────────
export function AudioCard({
  src,
  persona,
  title,
}: {
  src: string;
  persona?: string | null;
  title?: string;
}) {
  const caption = [persona, title ? title.slice(0, 50) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <Mic2 className="h-4 w-4 text-[var(--text-secondary)]" />
          <span className="text-[17px] font-semibold text-[var(--text-primary)] ">
            Audio TTS
          </span>
          <a href={src} download className="ml-auto">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[var(--text-secondary)] hover:text-[var(--text-primary)] "
            >
              <Download className="h-4 w-4" />
            </Button>
          </a>
        </div>
        {caption && (
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">{caption}</p>
        )}
        <audio controls src={src} preload="metadata" className="mt-3 w-full" />
      </CardContent>
    </Card>
  );
} // ── Pending ────────────────────────────────────────────────────────────────────
export function AudioCardPending() {
  return (
    <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
      <CardContent className="flex items-center gap-3 p-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] ">
          <Clock className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
        </div>
        <div>
          <p className="text-[15px] font-medium text-[var(--text-primary)] ">
            Đang chờ tạo audio
          </p>
          <p className="text-[13px] text-[var(--text-muted)]">
            Tự động xử lý ở cron tick tiếp theo (~5 phút)
          </p>
        </div>
      </CardContent>
    </Card>
  );
} // ── No mapping ────────────────────────────────────────────────────────────────
export function AudioCardNoMapping({
  featuredPerson,
}: {
  featuredPerson?: string | null;
}) {
  const personaStatus = getPersonaUiStatus(featuredPerson);
  const personaName = formatPersonaName(featuredPerson || FIXED_PERSONA_NAME);
  return (
    <Card className="border-[var(--border-subtle)] shadow-none rounded-xl ">
      <CardContent className="flex items-start gap-3 p-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--warning-soft)] ">
          <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
        </div>
        <div>
          <p className="text-[15px] font-medium text-[var(--text-primary)] ">
            Chưa có clone voice cho {personaName}
          </p>
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
            {personaStatus === "legacy" ? (
              <>
                Đây là video legacy trước fixed persona. Nếu cần tạo audio cho
                video này, thêm mapping cho {personaName} thủ công tại{" "}
                <Link
                  href="/settings"
                  className="text-[var(--accent-cyan)] hover:underline"
                >
                  Cài đặt → Giọng TTS cố định
                </Link>
                .
              </>
            ) : (
              <>
                Thêm mapping {FIXED_PERSONA_NAME} → {FIXED_PERSONA_VOICE_ID} tại{" "}
                <Link
                  href="/settings"
                  className="text-[var(--accent-cyan)] hover:underline"
                >
                  Cài đặt → Giọng TTS cố định
                </Link>{" "}
                rồi chạy lại pipeline.
              </>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
