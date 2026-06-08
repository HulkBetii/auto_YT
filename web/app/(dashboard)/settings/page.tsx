import { getConfigValue } from "@/lib/db/repo/channel-config";
import { SETTINGS_FIELDS } from "@/lib/settings/fields";
import { formatDateTime } from "@/lib/ui/format";
import { db } from "@/lib/db";
import { channelConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

import { SettingField } from "./SettingField";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [values, [heartbeat]] = await Promise.all([
    Promise.all(SETTINGS_FIELDS.map(async (field) => ({ field, value: (await getConfigValue(field.key)) ?? "" }))),
    db.select().from(channelConfig).where(eq(channelConfig.key, "worker_heartbeat")).limit(1),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Cài đặt</h1>

      <section className="flex flex-col gap-3">
        {values.map(({ field, value }) => (
          <SettingField key={field.key} fieldKey={field.key} label={field.label} description={field.description} initialValue={value} />
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Trạng thái Worker</h2>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-zinc-600 dark:text-zinc-400">
            Lần thấy gần nhất: <span className="font-medium text-zinc-900 dark:text-zinc-50">{formatDateTime(heartbeat?.workerLastSeenAt)}</span>
            {" · "}
            Trạng thái: <span className="font-medium text-zinc-900 dark:text-zinc-50">{heartbeat?.workerLastStatus ?? "—"}</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Được ghi lại bởi worker Playwright ở mỗi vòng poll (chỉ xem ở đây — xem Phase 7 để biết logic cảnh báo).
          </p>
        </div>
      </section>
    </div>
  );
}
