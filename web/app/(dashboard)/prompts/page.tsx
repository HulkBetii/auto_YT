import Link from "next/link";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { promptKeyEnum, promptVersions } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  const activeByKey = await Promise.all(
    promptKeyEnum.enumValues.map(async (key) => {
      const [active] = await db
        .select()
        .from(promptVersions)
        .where(and(eq(promptVersions.promptKey, key), eq(promptVersions.isActive, true)))
        .limit(1);
      return { key, active };
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Prompt</h1>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-2">Key</th>
              <th className="px-4 py-2">Phiên bản đang dùng</th>
              <th className="px-4 py-2">Tạo bởi</th>
              <th className="px-4 py-2">Kích hoạt lúc</th>
            </tr>
          </thead>
          <tbody>
            {activeByKey.map(({ key, active }) => (
              <tr key={key} className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
                <td className="px-4 py-2">
                  <Link href={`/prompts/${key}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                    {key}
                  </Link>
                </td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{active ? `v${active.version}` : "—"}</td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{active?.createdBy ?? "—"}</td>
                <td className="px-4 py-2 text-zinc-500">{formatDateTime(active?.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
