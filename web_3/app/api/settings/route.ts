import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAllDrConfig, setDrConfigValue } from "@/lib/db/repo/channel-config";
import { hasStudySettingValue, setStudySettingValue } from "@/lib/db/repo/study-settings";
import { DR_CONFIG_KEYS, STUDY_SETTING_KEYS } from "@/lib/db/schema";

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

  const [config, ai33ApiKeyConfigured] = await Promise.all([
    getAllDrConfig(),
    hasStudySettingValue(STUDY_SETTING_KEYS.ai33ApiKey),
  ]);
  return NextResponse.json({
    ok: true,
    config,
    study: { ai33ApiKeyConfigured },
  });
}

export async function POST(request: Request) {
  if (!(await assertAuth())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody: unknown = await request.json();
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return NextResponse.json({ ok: false, error: "Invalid settings payload" }, { status: 400 });
  }
  const body = parsedBody as Record<string, unknown>;
  const studyApiKeyInput = body[STUDY_SETTING_KEYS.ai33ApiKey];
  if (
    STUDY_SETTING_KEYS.ai33ApiKey in body &&
    (typeof studyApiKeyInput !== "string" || studyApiKeyInput.trim().length === 0)
  ) {
    return NextResponse.json(
      { ok: false, error: "Study AI33.PRO API key cannot be empty" },
      { status: 400 },
    );
  }
  const updated: string[] = [];

  for (const key of EDITABLE_KEYS) {
    if (key in body && typeof body[key] === "string") {
      await setDrConfigValue(key, body[key]);
      updated.push(key);
    }
  }

  if (typeof studyApiKeyInput === "string") {
    await setStudySettingValue(STUDY_SETTING_KEYS.ai33ApiKey, studyApiKeyInput.trim());
    updated.push(STUDY_SETTING_KEYS.ai33ApiKey);
  }

  // Never include the key value in a response, even when it was just updated.
  const ai33ApiKeyConfigured = await hasStudySettingValue(STUDY_SETTING_KEYS.ai33ApiKey);
  return NextResponse.json({ ok: true, updated, study: { ai33ApiKeyConfigured } });
}
