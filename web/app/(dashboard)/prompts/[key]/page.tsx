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

export default async function PromptDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!(promptKeyEnum.enumValues as readonly string[]).includes(key)) notFound();
  const promptKey = key as (typeof promptKeyEnum.enumValues)[number];

  const [versions, autoUpdatePaused] = await Promise.all([
    db.select().from(promptVersions).where(eq(promptVersions.promptKey, promptKey)).orderBy(desc(promptVersions.version)),
    getConfigValue("auto_update_paused"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/prompts" className="text-sm text-zinc-500 hover:underline">
          ← All prompts
        </Link>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{promptKey}</h1>
      </div>

      {autoUpdatePaused === "true" && promptKey === "P1" && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <span>
            Auto-update is <strong>paused</strong> — the rollback rate limit (1 per 30 days) was reached and this
            prompt was flagged for manual review.
          </span>
          <UnpauseButton />
        </div>
      )}

      <ol className="flex flex-col gap-3">
        {versions.map((version) => (
          <li
            key={version.id}
            className={`rounded-lg border p-4 ${version.isActive ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"}`}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">v{version.version}</span>
                {version.isActive && (
                  <span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">active</span>
                )}
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {version.createdBy}
                </span>
                <span className="text-xs text-zinc-500">{formatDateTime(version.createdAt)}</span>
              </div>
              {!version.isActive && <ActivateButton promptKey={promptKey} versionId={version.id} />}
            </div>

            {version.changeReason && (
              <details className="mb-2">
                <summary className="cursor-pointer text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
                  Change reason / report
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-3 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {version.changeReason}
                </pre>
              </details>
            )}

            <details>
              <summary className="cursor-pointer text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
                Template ({version.template.length.toLocaleString()} chars)
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-3 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {version.template}
              </pre>
            </details>
          </li>
        ))}
        {versions.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No versions for this prompt key yet.
          </li>
        )}
      </ol>
    </div>
  );
}
