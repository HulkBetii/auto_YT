import { NextResponse } from "next/server";
import { z } from "zod";

import { setConfigValue } from "@/lib/db/repo/channel-config";
import { SETTINGS_FIELDS } from "@/lib/settings/fields";

const bodySchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });

  const field = SETTINGS_FIELDS.find((f) => f.key === parsed.data.key);
  if (!field) return NextResponse.json({ ok: false, error: "Unknown setting key" }, { status: 400 });

  const validated = field.schema.safeParse(parsed.data.value);
  if (!validated.success) {
    return NextResponse.json({ ok: false, error: validated.error.issues[0]?.message ?? "Invalid value" }, { status: 400 });
  }

  await setConfigValue(field.key, parsed.data.value);
  return NextResponse.json({ ok: true });
}
