import { getAllDrConfig } from "@/lib/db/repo/channel-config";
import { DR_CONFIG_KEYS } from "@/lib/db/schema";
import { SettingField } from "./SettingField";

export const dynamic = "force-dynamic";

const FIELDS = [
  {
    key: DR_CONFIG_KEYS.targetSceneCount,
    label: "Target Scene Count (D0)",
    description: "How many scene candidates D0 generates before picking one (default 5)",
    placeholder: "5",
  },
  {
    key: DR_CONFIG_KEYS.sunoModelVersion,
    label: "Suno Model Version",
    description: "AI33.PRO Suno major_model_version (default v4.5-all)",
    placeholder: "v4.5-all",
  },
  {
    key: DR_CONFIG_KEYS.web3Url,
    label: "Web3 URL",
    description: "Production URL for this dashboard (used for worker callbacks)",
    placeholder: "https://your-domain.vercel.app",
  },
] as const;

export default async function SettingsPage() {
  const config = await getAllDrConfig();

  return (
    <>
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
          Settings
        </h1>
        <p className="mt-1 text-[15px] leading-relaxed text-[#6E6E73] dark:text-[#AEAEB2]">
          Configure pipeline constants and integrations.
        </p>
      </div>

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
