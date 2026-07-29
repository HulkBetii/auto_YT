import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWeek: vi.fn(),
  markFailed: vi.fn(),
  scanTracks: vi.fn(),
  updateScan: vi.fn(),
}));

vi.mock("@/lib/db/repo/study", () => ({
  getStudyAudioWeek: mocks.getWeek,
  markStudyAudioWeekFailed: mocks.markFailed,
  updateStudyAudioWeekScan: mocks.updateScan,
}));

vi.mock("@/lib/study/media", () => ({ scanStudyAudioTracks: mocks.scanTracks }));

vi.mock("@/lib/study/project", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/study/project")>();
  return {
    ...actual,
    getStudyWeekPaths: () => ({ mediaRoot: "D:/study", audioDir: "D:/study/audio/week-001" }),
  };
});

import { POST as scanWeek } from "./weeks/[id]/scan/route";

const manifest = {
  files: Array.from({ length: 20 }, (_, index) => ({
    fileName: `${index + 1}.mp3`,
    relativePath: `audio/week-001/${index + 1}.mp3`,
    sha256: `track-${index + 1}`,
    sizeBytes: 100,
    durationSec: 180,
    codecName: "mp3",
    sampleRate: 44100,
    channels: 2,
  })),
  scannedAt: "2026-07-26T00:00:00.000Z",
};

function request(confirmCommercialRights: boolean): Request {
  const secret = process.env.DASHBOARD_SECRET;
  return new Request("http://localhost:3002/api/study/weeks/1/scan", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ confirmCommercialRights }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWeek.mockResolvedValue({ id: 1, weekNumber: 1, status: "awaiting_rights" });
  mocks.scanTracks.mockResolvedValue(manifest);
  mocks.updateScan.mockResolvedValue({ id: 1, status: "awaiting_rights" });
  mocks.markFailed.mockResolvedValue(null);
});

describe("study audio scan API", () => {
  it("keeps scanned tracks awaiting rights when confirmation is false", async () => {
    const response = await scanWeek(request(false), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(200);
    expect(mocks.updateScan).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      rightsVerifiedAt: null,
      totalDurationSec: 3600,
    }));
  });

  it("records a rights timestamp only after explicit confirmation", async () => {
    const response = await scanWeek(request(true), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(200);
    expect(mocks.updateScan.mock.calls[0][0].rightsVerifiedAt).toBeInstanceOf(Date);
  });

  it("does not scan while music generation owns the week", async () => {
    mocks.getWeek.mockResolvedValue({ id: 1, weekNumber: 1, status: "generating" });
    const response = await scanWeek(request(false), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(409);
    expect(mocks.scanTracks).not.toHaveBeenCalled();
    expect(mocks.updateScan).not.toHaveBeenCalled();
  });
});
