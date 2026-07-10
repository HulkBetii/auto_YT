import { getAllDrConfig } from "@/lib/db/repo/channel-config";
import { DR_CONFIG_KEYS } from "@/lib/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { SettingField } from "./SettingField";
export const dynamic = "force-dynamic";
const FIELDS = [
  {
    key: DR_CONFIG_KEYS.targetSceneCount,
    label: "Target Scene Count (D0)",
    description:
      "How many scene candidates D0 generates before picking one (default 5)",
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
    description:
      "Production URL for this dashboard (used for worker callbacks)",
    placeholder: "https://your-domain.vercel.app",
  },
] as const;
export default async function SettingsPage() {
  let config: Record<string, string> = {};
  let dbError: string | null = null;
  try {
    config = await getAllDrConfig();
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
    console.error("[settings] database unavailable", dbError);
  }
  return (
    <>
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text-primary)]">
          Settings
        </h1>
        <p className="mt-1 text-[15px] leading-relaxed text-[var(--text-muted)]">
          Configure pipeline constants and integrations.
        </p>
      </div>
      <section>
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-secondary)]">
          PIPELINE CONFIG
        </p>
        {dbError && (
          <Card className="mb-3 border-[var(--warning)]/30 bg-[var(--warning-soft)] shadow-none rounded-xl">
            <CardContent className="p-5 text-[14px] text-[var(--warning)]">
              Database temporarily unavailable. Settings are shown with empty
              values until the database is available again.
            </CardContent>
          </Card>
        )}
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
