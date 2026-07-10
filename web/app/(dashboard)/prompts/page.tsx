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
        .where(
          and(
            eq(promptVersions.promptKey, key),
            eq(promptVersions.isActive, true),
          ),
        )
        .limit(1);
      return { key, active };
    }),
  );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-[var(--text-primary)] ">
        Prompt
      </h1>
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] ">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-subtle)] text-left text-xs uppercase text-[var(--text-muted)] ">
            <tr>
              <th className="px-4 py-2">Key</th>
              <th className="px-4 py-2">Phiên bản đang dùng</th>
              <th className="px-4 py-2">Tạo bởi</th>
              <th className="px-4 py-2">Kích hoạt lúc</th>
            </tr>
          </thead>
          <tbody>
            {activeByKey.map(({ key, active }) => (
              <tr
                key={key}
                className="border-t border-[var(--border-subtle)] hover:bg-[var(--surface-subtle)]"
              >
                <td className="px-4 py-2">
                  <Link
                    href={`/prompts/${key}`}
                    className="font-medium text-[var(--text-primary)] hover:underline "
                  >
                    {key}
                  </Link>
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)] ">
                  {active ? `v${active.version}` : "—"}
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)] ">
                  {active?.createdBy ?? "—"}
                </td>
                <td className="px-4 py-2 text-[var(--text-muted)]">
                  {formatDateTime(active?.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
