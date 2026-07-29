import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  ensureDayDirs: vi.fn(),
  findDuplicates: vi.fn(),
  getVideo: vi.fn(),
  getWeek: vi.fn(),
  markFailed: vi.fn(),
  resolveOverlayFont: vi.fn(),
  scanFootage: vi.fn(),
  assertDiskSpace: vi.fn(),
}));

vi.mock("@/lib/db/repo/study", () => ({
  claimStudyDailyVideoForAssembly: mocks.claim,
  findDuplicateStudyFootageHashes: mocks.findDuplicates,
  getStudyAudioWeek: mocks.getWeek,
  getStudyDailyVideo: mocks.getVideo,
  markStudyDailyVideoFailed: mocks.markFailed,
}));

vi.mock("@/lib/study/media", () => ({
  assertSufficientStudyDiskSpace: mocks.assertDiskSpace,
  createStudyInputSignature: () => "input-signature",
  scanStudyFootage: mocks.scanFootage,
}));

vi.mock("@/lib/study/project", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/study/project")>();
  return {
    ...actual,
    ensureStudyDayDirs: mocks.ensureDayDirs,
    resolveStudyOverlayFontPath: mocks.resolveOverlayFont,
  };
});

import { POST as assembleVideo } from "./videos/[id]/assemble/route";

const tracks = Array.from({ length: 20 }, (_, index) => ({
  fileName: `${index + 1}.mp3`,
  relativePath: `audio/week-001/${index + 1}.mp3`,
  sha256: `track-${index + 1}`,
  sizeBytes: 100,
  durationSec: 180,
  codecName: "mp3",
  sampleRate: 44100,
  channels: 2,
}));

const footageManifest = {
  files: [
    {
      fileName: "001.mp4",
      relativePath: "daily/day-001/source/001.mp4",
      sha256: "footage-1",
      sizeBytes: 1000,
      durationSec: 60,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codecName: "h264",
      hasAudio: true,
    },
  ],
  scannedAt: "2026-07-26T00:00:00.000Z",
};

function request(): Request {
  const secret = process.env.DASHBOARD_SECRET;
  return new Request("http://localhost:3002/api/study/videos/1/assemble", {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

function video(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    dayNumber: 1,
    weekId: 1,
    status: "draft",
    assemblyStartedAt: null,
    previewStatus: "idle",
    previewHeartbeatAt: null,
    ...overrides,
  };
}

function readyWeek(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    weekNumber: 1,
    status: "ready",
    rightsVerifiedAt: new Date("2026-07-26T00:00:00Z"),
    trackManifest: { files: tracks, scannedAt: "2026-07-26T00:00:00.000Z" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVideo.mockResolvedValue(video());
  mocks.getWeek.mockResolvedValue(readyWeek());
  mocks.ensureDayDirs.mockResolvedValue({
    mediaRoot: "D:/study",
    sourceDir: "D:/study/daily/day-001/source",
    outputDir: "D:/study/daily/day-001/output",
    logPath: "D:/study/daily/day-001/output/assembly.log",
  });
  mocks.scanFootage.mockResolvedValue(footageManifest);
  mocks.findDuplicates.mockResolvedValue([]);
  mocks.assertDiskSpace.mockResolvedValue(undefined);
  mocks.claim.mockResolvedValue(false);
  mocks.markFailed.mockResolvedValue(null);
  mocks.resolveOverlayFont.mockReturnValue("C:\\Windows\\Fonts\\consolab.ttf");
});

describe("study assemble API gates", () => {
  it.each([
    ["week not ready", { status: "draft" }],
    ["commercial rights awaiting confirmation", { status: "awaiting_rights" }],
    ["commercial rights unverified", { rightsVerifiedAt: null }],
  ])("blocks assembly when %s", async (_label, overrides) => {
    mocks.getWeek.mockResolvedValue(readyWeek(overrides));
    const response = await assembleVideo(request(), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(409);
    expect(mocks.scanFootage).not.toHaveBeenCalled();
  });

  it.each([
    "Footage source folder is empty",
    "Footage folder contains unsupported files: notes.txt",
  ])("returns a validation error for source failure: %s", async (message) => {
    mocks.scanFootage.mockRejectedValue(new Error(message));
    const response = await assembleVideo(request(), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: message });
    expect(mocks.markFailed).toHaveBeenCalledWith(1, message, null);
  });

  it("blocks footage whose checksum was used by another day", async () => {
    mocks.findDuplicates.mockResolvedValue([{ sha256: "footage-1", dayNumber: 7 }]);
    const response = await assembleVideo(request(), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Footage was already used on day(s): 7" });
    expect(mocks.assertDiskSpace).not.toHaveBeenCalled();
  });

  it("rejects a fresh assembling job before scanning footage", async () => {
    mocks.getVideo.mockResolvedValue(video({
      status: "assembling",
      assemblyStartedAt: new Date(Date.now() - 60_000),
    }));
    const response = await assembleVideo(request(), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(409);
    expect(mocks.getWeek).not.toHaveBeenCalled();
    expect(mocks.scanFootage).not.toHaveBeenCalled();
  });

  it("rejects assembly while a preview heartbeat is fresh", async () => {
    mocks.getVideo.mockResolvedValue(video({
      previewStatus: "rendering",
      previewHeartbeatAt: new Date(Date.now() - 60_000),
    }));
    const response = await assembleVideo(request(), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(409);
    expect(mocks.getWeek).not.toHaveBeenCalled();
    expect(mocks.scanFootage).not.toHaveBeenCalled();
  });

  it("rejects a missing overlay font before scanning or claiming", async () => {
    mocks.resolveOverlayFont.mockImplementation(() => {
      throw new Error(
        "STUDY_OVERLAY_FONT must be an absolute path to an existing font file: C:\\missing.ttf",
      );
    });
    const response = await assembleVideo(request(), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("STUDY_OVERLAY_FONT") });
    expect(mocks.scanFootage).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});
