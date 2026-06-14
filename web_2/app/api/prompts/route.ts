import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActiveAhPromptVersion, insertAhPromptVersion } from "@/lib/db/repo/prompt-versions";

const PROMPT_KEYS = ["S1", "S2", "S3", "S4"];

async function assertAuth() {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  return !secret || auth === secret;
}

export async function GET() {
  if (!(await assertAuth())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const prompts = await Promise.all(
    PROMPT_KEYS.map(async (key) => {
      const row = await getActiveAhPromptVersion(key);
      return { key, row };
    }),
  );

  return NextResponse.json({ ok: true, prompts });
}

export async function POST(request: Request) {
  if (!(await assertAuth())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as { promptKey?: string; template?: string; changeReason?: string };

  if (!body.promptKey || !PROMPT_KEYS.includes(body.promptKey)) {
    return NextResponse.json({ ok: false, error: "Invalid promptKey" }, { status: 400 });
  }
  if (!body.template?.trim()) {
    return NextResponse.json({ ok: false, error: "template is required" }, { status: 400 });
  }

  const created = await insertAhPromptVersion({
    promptKey: body.promptKey,
    template: body.template.trim(),
    createdBy: "dashboard",
    changeReason: body.changeReason?.trim() || undefined,
  });

  return NextResponse.json({ ok: true, version: created.version, id: created.id });
}
