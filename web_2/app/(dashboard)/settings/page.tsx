import { getAllAhConfig } from "@/lib/db/repo/channel-config";
import { AH_CONFIG_KEYS } from "@/lib/db/schema";
import { SettingField } from "./SettingField";
import { SettingSelect } from "./SettingSelect";

export const dynamic = "force-dynamic";

const FIELDS = [
  {
    key: AH_CONFIG_KEYS.voiceId,
    label: "Voice ID (Primary)",
    description: "ElevenLabs voice ID via AI33.PRO (e.g. elevenlabs_abc123)",
    placeholder: "elevenlabs_...",
  },
  {
    key: AH_CONFIG_KEYS.voiceId2,
    label: "Voice ID 2 (Backup · MiniMax)",
    description: "Fallback MiniMax voice via AI33.PRO — used if primary TTS fails",
    placeholder: "minimax_...",
  },
  {
    key: AH_CONFIG_KEYS.voiceIdGx,
    label: "Voice ID Genmax",
    description: "Voice ID dùng khi fallback sang Genmax (ElevenLabs ID hoặc MiniMax numeric ID)",
    placeholder: "e.g. EXAVITQu4vr4xnSDxMaL hoặc 123456789",
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

const TTS_PROVIDER_MODE_OPTIONS = [
  { value: "auto", label: "Auto: AI33 primary -> AI33 backup -> Genmax" },
  { value: "ai33_backup", label: "AI33 backup only: MiniMax voice ID 2" },
  { value: "genmax", label: "Genmax only: voice ID Genmax" },
] as const;

export default async function SettingsPage() {
  const config = await getAllAhConfig();

  return (
    <>
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
          Settings
        </h1>
        <p className="mt-1 text-[15px] leading-relaxed text-[#6E6E73] dark:text-[#AEAEB2]">
          Configure external integrations and pipeline constants.
        </p>
      </div>

      <section>
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[#AEAEB2]">
          PIPELINE CONFIG
        </p>
        <div className="space-y-3">
          <SettingSelect
            fieldKey={AH_CONFIG_KEYS.ttsProviderMode}
            label="TTS Provider Mode"
            description="Switch immediately on the next Run Pipeline cycle"
            initialValue={config[AH_CONFIG_KEYS.ttsProviderMode] ?? "auto"}
            options={TTS_PROVIDER_MODE_OPTIONS}
          />
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
