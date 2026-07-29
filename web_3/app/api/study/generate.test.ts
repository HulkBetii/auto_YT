import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  closeSync: vi.fn(),
  getWeek: vi.fn(),
  getSettingValue: vi.fn(),
  markFailed: vi.fn(),
  mkdir: vi.fn(),
  openSync: vi.fn(),
  readdir: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("@/lib/db/repo/study", () => ({
  claimStudyAudioWeekForGeneration: mocks.claim,
  getStudyAudioWeek: mocks.getWeek,
  markStudyAudioWeekGenerationFailed: mocks.markFailed,
}));

vi.mock("@/lib/db/repo/study-settings", () => ({
  STUDY_SETTING_KEYS: { ai33ApiKey: "ai33_api_key" },
  getStudySettingValue: mocks.getSettingValue,
}));

vi.mock("node:fs", () => ({
  closeSync: mocks.closeSync,
  existsSync: () => true,
  openSync: mocks.openSync,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  readdir: mocks.readdir,
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

import { POST as generateMusic } from "./weeks/[id]/generate/route";

const originalApiKey = process.env.SUNO_API_KEY;
const legacyPhases = [
  "First light setup",
  "Morning momentum",
  "Clear desk flow",
  "Deep work warmth",
  "Late-morning concentration",
  "Midday reset",
  "Quiet persistence",
  "Afternoon clarity",
  "Steady finish",
  "Golden-hour closure",
] as const;

function request(): Request {
  const secret = process.env.DASHBOARD_SECRET;
  return new Request("http://localhost:3002/api/study/weeks/1/generate", {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

function week(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    weekNumber: 1,
    status: "draft",
    generationManifest: null,
    generationHeartbeatAt: null,
    ...overrides,
  };
}

function fileEntry(name: string) {
  return { name, isFile: () => true };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUNO_API_KEY = "test-key";
  mocks.getWeek.mockResolvedValue(week());
  mocks.getSettingValue.mockResolvedValue(null);
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.readdir.mockResolvedValue([]);
  mocks.openSync.mockReturnValue(1);
  mocks.claim.mockImplementation(async (input) => ({ id: 1, ...input }));
  mocks.markFailed.mockResolvedValue(null);
  mocks.spawn.mockImplementation(() => {
    const child = {
      once: vi.fn((event: string, callback: () => void) => {
        if (event === "spawn") queueMicrotask(callback);
        return child;
      }),
      unref: vi.fn(),
    };
    return child;
  });
});

describe("study music generation API", () => {
  it("claims one run and creates the fixed 20-slot task-index manifest", async () => {
    const response = await generateMusic(request(), { params: Promise.resolve({ id: "1" }) });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      ok: true,
      mode: "start",
      progress: 0,
      taskCount: 0,
      maxProviderTasks: 20,
    });
    const input = mocks.claim.mock.calls[0][0];
    expect(input.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(input.generationManifest).toMatchObject({
      promptVersion: "study-organic-focus-v1",
      provider: "ai33.pro",
      maxProviderTasks: 20,
      tasks: [],
      lastKnownCredits: null,
    });
    expect(input.generationManifest.slots).toHaveLength(20);
    expect(
      input.generationManifest.slots.map((slot: { taskIndex: number }) => slot.taskIndex),
    ).toEqual(Array.from({ length: 20 }, (_, index) => Math.floor(index / 2) + 1));
    expect(input.generationManifest.slots.every((slot: Record<string, unknown>) => !("phase" in slot))).toBe(true);
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it("prefers the saved Study API key without exposing it in the response", async () => {
    const savedApiKey = "saved-study-key";
    mocks.getSettingValue.mockResolvedValue(savedApiKey);

    const response = await generateMusic(request(), { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(mocks.getSettingValue).toHaveBeenCalledWith("ai33_api_key");
    expect(mocks.spawn.mock.calls[0][2].env.SUNO_API_KEY).toBe(savedApiKey);
    expect(JSON.stringify(body)).not.toContain(savedApiKey);
  });

  it("falls back to SUNO_API_KEY when no saved Study key exists", async () => {
    mocks.getSettingValue.mockResolvedValue(null);

    const response = await generateMusic(request(), { params: Promise.resolve({ id: "1" }) });

    expect(response.status).toBe(202);
    expect(mocks.spawn.mock.calls[0][2].env.SUNO_API_KEY).toBe("test-key");
  });

  it("does not claim or spawn when neither API key source is configured", async () => {
    delete process.env.SUNO_API_KEY;
    mocks.getSettingValue.mockResolvedValue("  ");

    const response = await generateMusic(request(), { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, error: "AI33.PRO API key is not configured" });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("rejects a fresh generation before touching files or claiming another run", async () => {
    mocks.getWeek.mockResolvedValue(week({
      status: "generating",
      generationHeartbeatAt: new Date(Date.now() - 60_000),
    }));

    const response = await generateMusic(request(), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(409);
    expect(mocks.readdir).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("uses the atomic claim to reject a concurrent double-click", async () => {
    mocks.claim.mockResolvedValue(null);
    const response = await generateMusic(request(), { params: Promise.resolve({ id: "1" }) });

    expect(response.status).toBe(409);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("does not start a fresh generation over manually supplied MP3 files", async () => {
    mocks.readdir.mockResolvedValue([fileEntry("manual.mp3")]);
    const response = await generateMusic(request(), { params: Promise.resolve({ id: "1" }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Audio week already contains MP3 files; generation requires an empty week",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("resumes a stale run while preserving manifest-managed files", async () => {
    const generationManifest = {
      promptVersion: "study-organic-focus-v1",
      provider: "ai33.pro" as const,
      maxProviderTasks: 20,
      tasks: [{
        submissionIndex: 1,
        phase: "First light setup",
        status: "done" as const,
        providerTaskId: "task-1",
        submittedAt: "2026-07-26T00:00:00.000Z",
      }],
      slots: Array.from({ length: 20 }, (_, index) => ({
        slotNumber: index + 1,
        phase: legacyPhases[Math.floor(index / 2)],
        status: index === 0 ? "downloaded" as const : "pending" as const,
        ...(index === 0 ? { fileName: "01.mp3" } : {}),
      })),
      lastKnownCredits: 9000,
      updatedAt: "2026-07-26T00:00:00.000Z",
    };
    mocks.getWeek.mockResolvedValue(week({
      status: "generating",
      generationHeartbeatAt: new Date(Date.now() - 10 * 60_000),
      generationManifest,
    }));
    mocks.readdir.mockResolvedValue([fileEntry("01.mp3")]);

    const response = await generateMusic(request(), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ mode: "resume", progress: 1, taskCount: 1 });
    const claimedManifest = mocks.claim.mock.calls[0][0].generationManifest;
    expect(claimedManifest.tasks).toEqual([{
      submissionIndex: 1,
      taskIndex: 1,
      status: "done",
      providerTaskId: "task-1",
      submittedAt: "2026-07-26T00:00:00.000Z",
    }]);
    expect(claimedManifest.slots.map((slot: { taskIndex: number }) => slot.taskIndex)).toEqual(
      Array.from({ length: 20 }, (_, index) => Math.floor(index / 2) + 1),
    );
    expect(claimedManifest.slots.every((slot: Record<string, unknown>) => !("phase" in slot))).toBe(true);
  });

  it("rejects unmanaged files during resume", async () => {
    mocks.getWeek.mockResolvedValue(week({
      status: "failed",
      generationManifest: {
        promptVersion: "study-organic-focus-v1",
        provider: "ai33.pro",
        maxProviderTasks: 20,
        tasks: [],
        slots: [],
        lastKnownCredits: null,
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    }));
    mocks.readdir.mockResolvedValue([fileEntry("01.mp3")]);

    const response = await generateMusic(request(), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Audio week contains unmanaged MP3 files: 01.mp3" });
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("keeps generated and rights-gated weeks immutable", async () => {
    mocks.getWeek.mockResolvedValue(week({ status: "awaiting_rights" }));
    const response = await generateMusic(request(), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(409);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  if (originalApiKey === undefined) delete process.env.SUNO_API_KEY;
  else process.env.SUNO_API_KEY = originalApiKey;
});
