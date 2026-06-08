import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { activateNewPromptVersion } from "@/lib/db/repo/prompt-versions";
import { promptKeyEnum, promptVersions } from "@/lib/db/schema";

const bodySchema = z.object({ versionId: z.number().int().positive() });

/**
 * Manual override path (Phase 6 spec item 5): "Activate this version" creates a
 * brand-new active version carrying the selected version's template — reusing
 * `activateNewPromptVersion` keeps the exactly-one-active invariant and audit
 * trail consistent with the system_p6/system_rollback paths, rather than
 * special-casing an in-place flip of an old row.
 */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!(promptKeyEnum.enumValues as readonly string[]).includes(key)) {
    return NextResponse.json({ ok: false, error: "Unknown prompt key" }, { status: 400 });
  }
  const promptKey = key as (typeof promptKeyEnum.enumValues)[number];

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });

  const [source] = await db.select().from(promptVersions).where(eq(promptVersions.id, parsed.data.versionId)).limit(1);
  if (!source || source.promptKey !== promptKey) {
    return NextResponse.json({ ok: false, error: "Version not found for this prompt key" }, { status: 404 });
  }
  if (source.isActive) {
    return NextResponse.json({ ok: false, error: "This version is already active" }, { status: 400 });
  }

  const created = await activateNewPromptVersion({
    promptKey,
    template: source.template,
    createdBy: "manual",
    changeReason: `Manually reactivated v${source.version} (id ${source.id}) from the dashboard.`,
  });

  return NextResponse.json({ ok: true, activated: created });
}
