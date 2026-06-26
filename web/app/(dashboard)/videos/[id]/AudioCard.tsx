import Link from "next/link";
import { AlertTriangle, Clock, Download, Mic2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ── Done: native audio player ──────────────────────────────────────────────────
export function AudioCard({
  src,
  character,
  title,
}: {
  src: string;
  character?: string | null;
  title?: string;
}) {
  const caption = [character, title ? title.slice(0, 50) : null].filter(Boolean).join(" · ");

  return (
    <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <Mic2 className="h-4 w-4 text-[#AEAEB2]" />
          <span className="text-[17px] font-semibold text-[#1C1C1E] dark:text-white">Audio TTS</span>
          <a href={src} download className="ml-auto">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-[#AEAEB2] hover:text-[#1C1C1E] dark:hover:text-white">
              <Download className="h-4 w-4" />
            </Button>
          </a>
        </div>
        {caption && (
          <p className="mt-1 text-[13px] text-[#6E6E73]">{caption}</p>
        )}
        <audio controls src={src} preload="metadata" className="mt-3 w-full" />
      </CardContent>
    </Card>
  );
}

// ── Pending ────────────────────────────────────────────────────────────────────
export function AudioCardPending() {
  return (
    <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
      <CardContent className="flex items-center gap-3 p-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E5E5EA] dark:bg-white/[.10]">
          <Clock className="h-4 w-4 animate-spin text-[#6E6E73]" />
        </div>
        <div>
          <p className="text-[15px] font-medium text-[#1C1C1E] dark:text-white">Đang chờ tạo audio</p>
          <p className="text-[13px] text-[#6E6E73]">Tự động xử lý ở cron tick tiếp theo (~5 phút)</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── No mapping ────────────────────────────────────────────────────────────────
export function AudioCardNoMapping({ featuredPerson }: { featuredPerson?: string | null }) {
  return (
    <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
      <CardContent className="flex items-start gap-3 p-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FFF3D1] dark:bg-[#FF9F0A]/10">
          <AlertTriangle className="h-4 w-4 text-[#FF9F0A]" />
        </div>
        <div>
          <p className="text-[15px] font-medium text-[#1C1C1E] dark:text-white">
            Chưa có clone voice{featuredPerson ? ` cho ${featuredPerson}` : ""}
          </p>
          <p className="mt-0.5 text-[13px] text-[#6E6E73]">
            Thêm mapping tại{" "}
            <Link href="/settings" className="text-[#007AFF] hover:underline">
              Cài đặt → Bản đồ giọng TTS
            </Link>{" "}
            rồi chạy lại pipeline.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
