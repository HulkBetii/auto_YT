import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { promptKeyEnum, promptVersions } from "@/lib/db/schema";
import { getConfigValue } from "@/lib/db/repo/channel-config";
import { formatDateTime } from "@/lib/ui/format";
import { ActivateButton } from "./ActivateButton";
import { UnpauseButton } from "./UnpauseButton";
export const dynamic = "force-dynamic";
export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  if (!(promptKeyEnum.enumValues as readonly string[]).includes(key))
    notFound();
  const promptKey = key as (typeof promptKeyEnum.enumValues)[number];
  const [versions, autoUpdatePaused] = await Promise.all([
    db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptKey, promptKey))
      .orderBy(desc(promptVersions.version)),
    getConfigValue("auto_update_paused"),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/prompts"
          className="text-sm text-[var(--text-muted)] hover:underline"
        >
          ← Tất cả prompt
        </Link>
        <h1 className="text-xl font-semibold text-[var(--text-primary)] ">
          {promptKey}
        </h1>
      </div>
      {autoUpdatePaused === "true" && promptKey === "P1" && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning)] ">
          <span>
            Tự động cập nhật đang <strong>bị tạm dừng</strong> — đã đạt giới hạn
            tần suất rollback (1 lần / 30 ngày) và prompt này đã được gắn cờ để
            xem xét thủ công.
          </span>
          <UnpauseButton />
        </div>
      )}
      <ol className="flex flex-col gap-3">
        {versions.map((version) => (
          <li
            key={version.id}
            className={`rounded-lg border p-4 ${version.isActive ? "border-[var(--success)]/30 bg-[var(--success-soft)] " : "border-[var(--border-subtle)] bg-[var(--surface)] "}`}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--text-primary)] ">
                  v{version.version}
                </span>
                {version.isActive && (
                  <span className="rounded bg-[var(--success)] px-2 py-0.5 text-xs font-medium text-[var(--dashboard-bg)]">
                    đang dùng
                  </span>
                )}
                <span className="rounded bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)] ">
                  {version.createdBy}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {formatDateTime(version.createdAt)}
                </span>
              </div>
              {!version.isActive && (
                <ActivateButton promptKey={promptKey} versionId={version.id} />
              )}
            </div>
            {version.changeReason && (
              <details className="mb-2">
                <summary className="cursor-pointer text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  Lý do thay đổi / báo cáo
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-subtle)] p-3 text-xs text-[var(--text-secondary)] ">
                  {version.changeReason}
                </pre>
              </details>
            )}
            <details>
              <summary className="cursor-pointer text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                Mẫu prompt ({version.template.length.toLocaleString()} ký tự)
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-subtle)] p-3 text-xs text-[var(--text-secondary)] ">
                {version.template}
              </pre>
            </details>
          </li>
        ))}
        {versions.length === 0 && (
          <li className="rounded-lg border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--text-muted)] ">
            Chưa có phiên bản nào cho prompt key này.
          </li>
        )}
      </ol>
    </div>
  );
}
