import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  closeSync: vi.fn(),
  getWeek: vi.fn(),
  getSettingValue: vi.fn(),
  mkdir: vi.fn(),
  openSync: vi.fn(),
  restore: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("@/lib/db/repo/study", () => ({
  claimStudyAudioWeekTrackRegeneration: mocks.claim,
  getStudyAudioWeek: mocks.getWeek,
  restoreStudyAudioWeekAfterRegenerationLaunchFailure: mocks.restore,
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
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("@/lib/study/project", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/study/project")>();
  return {
    ...actual,
    getStudyWeekPaths: () => ({
      mediaRoot: "D:/study",
      audioDir: "D:/study/audio/week-001",
    }),
  };
});

import { POST as regenerate } from "./weeks/[id]/tracks/[slot]/regenerate/route";

function manifest(taskCount = 10) {
  return {
    promptVersion: "study-organic-focus-v1",
    provider: "ai33.pro" as const,
    maxProviderTasks: 20,
    tasks: Array.from({ length: taskCount }, (_, index) => ({
      submissionIndex: index + 1,
      taskIndex: (index % 10) + 1,
      status: "done" as const,
      providerTaskId: `task-${index + 1}`,
      submittedAt: "2026-07-27T00:00:00.000Z",
    })),
    slots: Array.from({ length: 20 }, (_, index) => ({
      slotNumber: index + 1,
      taskIndex: Math.floor(index / 2) + 1,
      status: "downloaded" as const,
      fileName: `${String(index + 1).padStart(2, "0")}.mp3`,
      relativePath: `audio/week-001/${String(index + 1).padStart(2, "0")}.mp3`,
      sha256: `hash-${index + 1}`,
      durationSec: 120,
      sizeBytes: 100,
      codecName: "mp3",
    })),
    lastKnownCredits: 9000,
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
}

function week(overrides: Record<string, unknown> = {}) {
  const generationManifest = manifest();
  return {
    id: 1,
    weekNumber: 1,
    status: "ready",
    updatedAt: new Date("2026-07-27T00:00:00.000Z"),
    generationHeartbeatAt: null,
    generationManifest,
    trackManifest: {
      files: generationManifest.slots.map((slot) => ({
        fileName: slot.fileName,
        relativePath: slot.relativePath,
        sha256: slot.sha256,
        sizeBytes: 100,
        durationSec: 120,
        codecName: "mp3",
        sampleRate: 44100,
        channels: 2,
      })),
      scannedAt: "2026-07-27T00:00:00.000Z",
    },
    rightsVerifiedAt: new Date("2026-07-27T00:00:00.000Z"),
    ...overrides,
  };
}

function request() {
  return new Request("http://localhost:3002/api/study/weeks/1/tracks/7/regenerate", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUNO_API_KEY = "test-key";
  mocks.getWeek.mockResolvedValue(week());
  mocks.getSettingValue.mockResolvedValue(null);
  mocks.claim.mockImplementation(async (input) => ({ id: 1, ...input }));
  mocks.restore.mockResolvedValue(null);
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.openSync.mockReturnValue(1);
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

describe("study track regeneration API", () => {
  it("claims and spawns a detached single-slot regeneration", async () => {
    const response = await regenerate(request(), {
      params: Promise.resolve({ id: "1", slot: "7" }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      ok: true,
      slot: 7,
      mode: "regenerate",
      taskCount: 10,
      maxProviderTasks: 20,
    });
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.claim.mock.calls[0][0].generationManifest.activeRegeneration).toMatchObject({
      targetSlot: 7,
      previousStatus: "ready",
    });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(["7"]));
  });

  it.each(["0", "21"])("rejects invalid slot %s without spawning", async (slot) => {
    const response = await regenerate(request(), {
      params: Promise.resolve({ id: "1", slot }),
    });
    expect(response.status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("rejects a fresh generation lease", async () => {
    mocks.getWeek.mockResolvedValue(week({
      status: "generating",
      generationHeartbeatAt: new Date(Date.now() - 30_000),
    }));
    const response = await regenerate(request(), {
      params: Promise.resolve({ id: "1", slot: "7" }),
    });
    expect(response.status).toBe(409);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("blocks a new regeneration once all provider submissions are spent", async () => {
    mocks.getWeek.mockResolvedValue(week({ generationManifest: manifest(20) }));
    const response = await regenerate(request(), {
      params: Promise.resolve({ id: "1", slot: "7" }),
    });
    expect(response.status).toBe(409);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
