import { getConfigValue } from "@/lib/db/repo/channel-config";
import { SETTINGS_FIELDS } from "@/lib/settings/fields";
import { formatDateTime } from "@/lib/ui/format";
import { db } from "@/lib/db";
import { channelConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { SettingField } from "./SettingField";
import { VoiceMapEditor } from "./VoiceMapEditor";

export const dynamic = "force-dynamic";

// Fields rendered as plain key/value inputs (excludes tts_voice_map which gets a custom UI)
const PLAIN_FIELDS = SETTINGS_FIELDS.filter(
  (f) => f.key !== "tts_voice_map",
);

export default async function SettingsPage() {
  const [values, [heartbeat]] = await Promise.all([
    Promise.all(SETTINGS_FIELDS.map(async (field) => ({ field, value: (await getConfigValue(field.key)) ?? "" }))),
    db.select().from(channelConfig).where(eq(channelConfig.key, "worker_heartbeat")).limit(1),
  ]);

  const valueMap = Object.fromEntries(values.map(({ field, value }) => [field.key, value]));

  return (
    <>
      <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
        Cài đặt
      </h1>

      {/* TTS Voice Map — custom UI */}
      <section>
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
          TTS — GIỌNG NÓI
        </p>
        <div className="flex flex-col gap-4">
          <VoiceMapEditor initialValue={valueMap["tts_voice_map"] ?? ""} />

          {/* Default voice — plain field */}
          {SETTINGS_FIELDS.filter((f) => f.key === "tts_default_voice").map((field) => (
            <SettingField
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              description={field.description}
              initialValue={valueMap[field.key] ?? ""}
            />
          ))}
        </div>
      </section>

      {/* All other settings */}
      <section>
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
          PIPELINE
        </p>
        <div className="flex flex-col gap-3">
          {PLAIN_FIELDS.filter((f) => f.key !== "tts_default_voice").map((field) => (
            <SettingField
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              description={field.description}
              initialValue={valueMap[field.key] ?? ""}
            />
          ))}
        </div>
      </section>

      {/* Worker status */}
      <section>
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
          WORKER
        </p>
        <Card className="border-black/[.08] shadow-none rounded-xl dark:border-white/[.10] dark:bg-[#1C1C1E]">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                  Lần thấy gần nhất
                </p>
                <p className="mt-0.5 text-[15px] text-[#1C1C1E] dark:text-white">
                  {formatDateTime(heartbeat?.workerLastSeenAt) ?? "—"}
                </p>
              </div>
              <Separator orientation="vertical" className="h-8 hidden sm:block bg-black/[.06] dark:bg-white/[.08]" />
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
                  Trạng thái
                </p>
                <p className="mt-0.5 text-[15px] text-[#1C1C1E] dark:text-white">
                  {heartbeat?.workerLastStatus ?? "—"}
                </p>
              </div>
            </div>
            <p className="mt-3 text-[13px] text-[#6E6E73]">
              Ghi lại bởi worker Playwright ở mỗi vòng poll.
            </p>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
