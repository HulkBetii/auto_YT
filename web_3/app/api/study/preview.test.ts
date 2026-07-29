import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  ensureDayDirs: vi.fn(),
  getVideo: vi.fn(),
  getWeek: vi.fn(),
  markFailed: vi.fn(),
  resolveOverlayFont: vi.fn(),
  scanFootage: vi.fn(),
}));

vi.mock("@/lib/db/repo/study", () => ({
  claimStudyDailyVideoForPreview: mocks.claim,
  getStudyAudioWeek: mocks.getWeek,
  getStudyDailyVideo: mocks.getVideo,
  markStudyDailyVideoPreviewFailed: mocks.markFailed,
}));

vi.mock("@/lib/study/project", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/study/project")>();
  return {
    ...actual,
    ensureStudyDayDirs: mocks.ensureDayDirs,
    resolveStudyOverlayFontPath: mocks.resolveOverlayFont,
  };
});

vi.mock("@/lib/study/media", () => ({ scanStudyFootage: mocks.scanFootage }));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = {
      once(event: string, callback: () => void) {
        if (event === "spawn") queueMicrotask(callback);
        return child;
      },
      unref: vi.fn(),
    };
    return child;
  }),
}));

import { POST as previewVideo } from "./videos/[id]/preview/route";

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
  files: [{
    fileName: "001.mp4",
    relativePath: "daily/day-001/source/001.mp4",
    sha256: "footage-1",
    sizeBytes: 1000,
    durationSec: 3050,
    width: 1920,
    height: 1080,
    frameRate: 30,
    codecName: "h264",
    hasAudio: false,
  }],
  scannedAt: "2026-07-26T00:00:00.000Z",
};

function request(body: unknown): Request {
  return new Request("http://localhost:3002/api/study/videos/1/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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
    workDir: "D:/study/daily/day-001/work",
    outputDir: "D:/study/daily/day-001/output",
    previewLogPath: "output/preview-api.log",
  });
  mocks.scanFootage.mockResolvedValue(footageManifest);
  mocks.claim.mockResolvedValue(new Date("2026-07-26T00:00:00Z"));
  mocks.markFailed.mockResolvedValue(true);
  mocks.resolveOverlayFont.mockReturnValue("C:\\Windows\\Fonts\\consolab.ttf");
});

describe("study preview API", () => {
  it("clamps a late request and returns the 90-second window", async () => {
    const response = await previewVideo(request({ atSeconds: 2970 }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      status: "rendering",
      requestedOffsetSec: 2970,
      actualOffsetSec: 2960,
      durationSec: 90,
    });
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      requestedOffsetSec: 2970,
      actualOffsetSec: 2960,
    }));
  });

  it.each([
    ["negative offset", { atSeconds: -1 }],
    ["non-finite offset", { atSeconds: null }],
  ])("rejects %s before scanning footage", async (_label, body) => {
    const response = await previewVideo(request(body), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(400);
    expect(mocks.scanFootage).not.toHaveBeenCalled();
  });

  it("blocks an unready week", async () => {
    mocks.getWeek.mockResolvedValue(readyWeek({ status: "awaiting_rights", rightsVerifiedAt: null }));
    const response = await previewVideo(request({}), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(409);
    expect(mocks.scanFootage).not.toHaveBeenCalled();
  });

  it("blocks a fresh assembly or preview", async () => {
    mocks.getVideo.mockResolvedValue(video({
      status: "assembling",
      assemblyStartedAt: new Date(Date.now() - 60_000),
    }));
    expect((await previewVideo(request({}), { params: Promise.resolve({ id: "1" }) })).status).toBe(409);
    mocks.getVideo.mockResolvedValue(video({
      previewStatus: "rendering",
      previewHeartbeatAt: new Date(Date.now() - 60_000),
    }));
    expect((await previewVideo(request({}), { params: Promise.resolve({ id: "1" }) })).status).toBe(409);
    expect(mocks.scanFootage).not.toHaveBeenCalled();
  });

  it("returns conflict when the atomic preview lease is lost", async () => {
    mocks.claim.mockResolvedValue(null);
    const response = await previewVideo(request({}), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(409);
  });

  it("rejects a missing overlay font before scanning or claiming", async () => {
    mocks.resolveOverlayFont.mockImplementation(() => {
      throw new Error(
        "STUDY_OVERLAY_FONT must be an absolute path to an existing font file: C:\\missing.ttf",
      );
    });
    const response = await previewVideo(request({}), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("STUDY_OVERLAY_FONT") });
    expect(mocks.scanFootage).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});
