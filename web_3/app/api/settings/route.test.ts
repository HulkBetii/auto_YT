import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAllDrConfig: vi.fn(),
  hasStudySettingValue: vi.fn(),
  setDrConfigValue: vi.fn(),
  setStudySettingValue: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}));

vi.mock("@/lib/db/repo/channel-config", () => ({
  getAllDrConfig: mocks.getAllDrConfig,
  setDrConfigValue: mocks.setDrConfigValue,
}));

vi.mock("@/lib/db/repo/study-settings", () => ({
  hasStudySettingValue: mocks.hasStudySettingValue,
  setStudySettingValue: mocks.setStudySettingValue,
}));

import { DR_CONFIG_KEYS, STUDY_SETTING_KEYS } from "@/lib/db/schema";
import { GET, POST } from "./route";

const originalDashboardSecret = process.env.DASHBOARD_SECRET;
const API_KEY = "test-ai33-secret";

function postRequest(body: unknown): Request {
  return new Request("http://localhost:3002/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DASHBOARD_SECRET = "";
  mocks.getAllDrConfig.mockResolvedValue({ [DR_CONFIG_KEYS.web3Url]: "http://localhost:3002" });
  mocks.hasStudySettingValue.mockResolvedValue(true);
  mocks.setDrConfigValue.mockResolvedValue(undefined);
  mocks.setStudySettingValue.mockResolvedValue(undefined);
});

describe("settings API Study key", () => {
  it("returns only whether the Study AI33 key is configured", async () => {
    const response = await GET();
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(responseText)).toMatchObject({
      ok: true,
      study: { ai33ApiKeyConfigured: true },
    });
    expect(responseText).not.toContain(API_KEY);
    expect(mocks.hasStudySettingValue).toHaveBeenCalledWith(STUDY_SETTING_KEYS.ai33ApiKey);
  });

  it("saves a non-empty key without echoing it in the response", async () => {
    const response = await POST(
      postRequest({ [STUDY_SETTING_KEYS.ai33ApiKey]: `  ${API_KEY}  ` }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(mocks.setStudySettingValue).toHaveBeenCalledWith(
      STUDY_SETTING_KEYS.ai33ApiKey,
      API_KEY,
    );
    expect(JSON.parse(responseText)).toMatchObject({
      ok: true,
      study: { ai33ApiKeyConfigured: true },
    });
    expect(responseText).not.toContain(API_KEY);
  });

  it("rejects an empty key before changing any setting", async () => {
    const response = await POST(
      postRequest({
        [DR_CONFIG_KEYS.web3Url]: "http://changed.example",
        [STUDY_SETTING_KEYS.ai33ApiKey]: "   ",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.setStudySettingValue).not.toHaveBeenCalled();
    expect(mocks.setDrConfigValue).not.toHaveBeenCalled();
  });

  it("keeps existing Drifter settings editable", async () => {
    const response = await POST(
      postRequest({ [DR_CONFIG_KEYS.web3Url]: "http://localhost:3002" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.setDrConfigValue).toHaveBeenCalledWith(
      DR_CONFIG_KEYS.web3Url,
      "http://localhost:3002",
    );
    expect(mocks.setStudySettingValue).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  if (originalDashboardSecret === undefined) delete process.env.DASHBOARD_SECRET;
  else process.env.DASHBOARD_SECRET = originalDashboardSecret;
});
