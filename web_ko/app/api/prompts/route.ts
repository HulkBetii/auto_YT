import { NextResponse } from "next/server";

import { isDashboardAuthorized } from "@/lib/auth";
import {
  ensureDefaultPrompts,
  getActivePrompt,
  insertPromptVersion,
  KO_PROMPT_KEYS,
  listPromptVersions,
  type KoPromptKey,
} from "@/lib/db/repo/prompts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isDashboardAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  await ensureDefaultPrompts();
  const [sourceAudit, outline, section, fidelityReview, history] = await Promise.all([
    getActivePrompt("source_audit"),
    getActivePrompt("outline"),
    getActivePrompt("section"),
    getActivePrompt("fidelity_review"),
    listPromptVersions(),
  ]);
  return NextResponse.json({
    ok: true,
    active: { source_audit: sourceAudit, outline, section, fidelity_review: fidelityReview },
    history,
  });
}

export async function POST(request: Request) {
  if (!(await isDashboardAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as {
    promptKey?: string;
    template?: string;
    changeReason?: string;
  };
  if (!KO_PROMPT_KEYS.includes(body.promptKey as KoPromptKey) || !body.template?.trim()) {
    return NextResponse.json({ ok: false, error: "Valid promptKey and template are required." }, { status: 400 });
  }
  try {
    const created = await insertPromptVersion({
      promptKey: body.promptKey as KoPromptKey,
      template: body.template,
      changeReason: body.changeReason,
    });
    return NextResponse.json({ ok: true, prompt: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
