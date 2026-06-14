import { getAllAhConfig } from "@/lib/db/repo/channel-config";
import { AH_CONFIG_KEYS } from "@/lib/db/schema";
import { SettingField } from "./SettingField";

export const dynamic = "force-dynamic";

const FIELDS = [
  {
    key: AH_CONFIG_KEYS.voiceId,
    label: "Voice ID",
    description: "ElevenLabs voice ID via AI33.PRO (e.g. elevenlabs_abc123)",
    placeholder: "elevenlabs_...",
  },
  {
    key: AH_CONFIG_KEYS.web2Url,
    label: "Web2 URL",
    description: "Production URL for this dashboard (used for worker callbacks)",
    placeholder: "https://your-domain.vercel.app",
  },
  {
    key: AH_CONFIG_KEYS.openaiModel,
    label: "OpenAI Model",
    description: "Model used for topic ranking (default: gpt-4o-mini)",
    placeholder: "gpt-4o-mini",
  },
] as const;

export default async function SettingsPage() {
  const config = await getAllAhConfig();

  return (
    <>
      <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
        Settings
      </h1>

      <section>
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
          PIPELINE CONFIG
        </p>
        <div className="space-y-3">
          {FIELDS.map((f) => (
            <SettingField
              key={f.key}
              fieldKey={f.key}
              label={f.label}
              description={f.description}
              initialValue={config[f.key] ?? ""}
              placeholder={f.placeholder}
            />
          ))}
        </div>
      </section>
    </>
  );
}
