import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAllDrConfig, setDrConfigValue } from "@/lib/db/repo/channel-config";
import { DR_CONFIG_KEYS } from "@/lib/db/schema";

const EDITABLE_KEYS = Object.values(DR_CONFIG_KEYS);

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

  const config = await getAllDrConfig();
  return NextResponse.json({ ok: true, config });
}

export async function POST(request: Request) {
  if (!(await assertAuth())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, string>;
  const updated: string[] = [];

  for (const key of EDITABLE_KEYS) {
    if (key in body && typeof body[key] === "string") {
      await setDrConfigValue(key, body[key]);
      updated.push(key);
    }
  }

  return NextResponse.json({ ok: true, updated });
}
