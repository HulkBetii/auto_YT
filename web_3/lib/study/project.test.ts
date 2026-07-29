import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clampStudyPreviewWindow,
  getStudyDayPaths,
  getStudyWeekPaths,
  isFreshStudyAssembly,
  isFreshStudyMusicGeneration,
  isFreshStudyPreview,
  studyAudioWeekStatusForRights,
  StudyVideoCreateSchema,
  weekNumberForDay,
} from "./project";

const originalMediaRoot = process.env.STUDY_MEDIA_ROOT;

afterEach(() => {
  if (originalMediaRoot === undefined) delete process.env.STUDY_MEDIA_ROOT;
  else process.env.STUDY_MEDIA_ROOT = originalMediaRoot;
});

describe("study project helpers", () => {
  it.each([
    [1, 1],
    [7, 1],
    [8, 2],
    [98, 14],
    [100, 15],
  ])("maps day %i to week %i", (dayNumber, weekNumber) => {
    expect(weekNumberForDay(dayNumber)).toBe(weekNumber);
  });

  it("rejects day numbers outside the 100-day challenge", () => {
    expect(StudyVideoCreateSchema.safeParse({ dayNumber: 0 }).success).toBe(false);
    expect(StudyVideoCreateSchema.safeParse({ dayNumber: 101 }).success).toBe(false);
    expect(() => weekNumberForDay(1.5)).toThrow();
  });

  it("derives all paths from STUDY_MEDIA_ROOT", () => {
    process.env.STUDY_MEDIA_ROOT = path.resolve("test-study-root");
    expect(getStudyWeekPaths(2).audioDir).toBe(
      path.join(path.resolve("test-study-root"), "audio", "week-002"),
    );
    const day = getStudyDayPaths(9);
    expect(day.sourceDir).toBe(
      path.join(path.resolve("test-study-root"), "daily", "day-009", "source"),
    );
    expect(day.workDir).toBe(
      path.join(path.resolve("test-study-root"), "daily", "day-009", "work"),
    );
    expect(day.masterVideoPath).toBe(path.join(day.workDir, "master_silent.mp4"));
    expect(day.finalVideoPath).toBe(path.join(day.outputDir, "final_video.mp4"));
  });

  it("only blocks assembly while its four-hour lease is fresh", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    expect(isFreshStudyAssembly("assembling", new Date("2026-07-26T10:00:00Z"), now)).toBe(true);
    expect(isFreshStudyAssembly("assembling", new Date("2026-07-26T07:00:00Z"), now)).toBe(false);
    expect(isFreshStudyAssembly("failed", new Date("2026-07-26T10:00:00Z"), now)).toBe(false);
  });

  it("only blocks music generation while its five-minute heartbeat is fresh", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    expect(isFreshStudyMusicGeneration("generating", new Date("2026-07-26T11:56:00Z"), now)).toBe(true);
    expect(isFreshStudyMusicGeneration("generating", new Date("2026-07-26T11:54:00Z"), now)).toBe(false);
    expect(isFreshStudyMusicGeneration("failed", new Date("2026-07-26T11:59:00Z"), now)).toBe(false);
  });

  it("clamps previews to a 90-second window", () => {
    expect(clampStudyPreviewWindow(0, 60)).toEqual({ actualOffsetSec: 0, durationSec: 60 });
    expect(clampStudyPreviewWindow(999, 120)).toEqual({ actualOffsetSec: 30, durationSec: 90 });
  });

  it("only blocks preview retries while the 30-minute heartbeat is fresh", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    expect(isFreshStudyPreview("rendering", new Date("2026-07-26T11:31:00Z"), now)).toBe(true);
    expect(isFreshStudyPreview("rendering", new Date("2026-07-26T11:29:00Z"), now)).toBe(false);
    expect(isFreshStudyPreview("failed", new Date("2026-07-26T11:59:00Z"), now)).toBe(false);
  });

  it("keeps scanned music rights-gated until confirmation", () => {
    expect(studyAudioWeekStatusForRights(null)).toBe("awaiting_rights");
    expect(studyAudioWeekStatusForRights(new Date("2026-07-26T00:00:00Z"))).toBe("ready");
  });
});
