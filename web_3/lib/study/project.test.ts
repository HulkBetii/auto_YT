import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clampStudyPreviewWindow,
  DEFAULT_STUDY_OVERLAY_FONT,
  getStudyDayPaths,
  getStudyWeekPaths,
  isFreshStudyAssembly,
  isFreshStudyMusicGeneration,
  isFreshStudyPreview,
  resolveStudyOverlayFontPath,
  studyAudioWeekStatusForRights,
  StudyWeekCreateSchema,
  StudyVideoCreateSchema,
  weekNumberForDay,
} from "./project";

const originalMediaRoot = process.env.STUDY_MEDIA_ROOT;
const originalOverlayFont = process.env.STUDY_OVERLAY_FONT;
const temporaryDirectories: string[] = [];

afterEach(() => {
  if (originalMediaRoot === undefined) delete process.env.STUDY_MEDIA_ROOT;
  else process.env.STUDY_MEDIA_ROOT = originalMediaRoot;
  if (originalOverlayFont === undefined) delete process.env.STUDY_OVERLAY_FONT;
  else process.env.STUDY_OVERLAY_FONT = originalOverlayFont;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("study project helpers", () => {
  it.each([
    [1, 1],
    [7, 1],
    [8, 2],
    [364, 52],
    [365, 53],
  ])("maps day %i to week %i", (dayNumber, weekNumber) => {
    expect(weekNumberForDay(dayNumber)).toBe(weekNumber);
  });

  it("accepts the 365-day and 53-week boundaries", () => {
    expect(StudyVideoCreateSchema.safeParse({ dayNumber: 365 }).success).toBe(true);
    expect(StudyWeekCreateSchema.safeParse({ weekNumber: 53 }).success).toBe(true);
  });

  it("rejects challenge numbers outside the supported range", () => {
    expect(StudyVideoCreateSchema.safeParse({ dayNumber: 0 }).success).toBe(false);
    expect(StudyVideoCreateSchema.safeParse({ dayNumber: 366 }).success).toBe(false);
    expect(StudyWeekCreateSchema.safeParse({ weekNumber: 0 }).success).toBe(false);
    expect(StudyWeekCreateSchema.safeParse({ weekNumber: 54 }).success).toBe(false);
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

  it("uses the pinned default Study overlay font", () => {
    delete process.env.STUDY_OVERLAY_FONT;
    expect(resolveStudyOverlayFontPath()).toBe(DEFAULT_STUDY_OVERLAY_FONT);
  });

  it("accepts a custom absolute Study overlay font file", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "study-overlay-font-"));
    temporaryDirectories.push(directory);
    const fontPath = path.join(directory, "custom.ttf");
    writeFileSync(fontPath, "test font");
    process.env.STUDY_OVERLAY_FONT = fontPath;
    expect(resolveStudyOverlayFontPath()).toBe(path.resolve(fontPath));
  });

  it.each([
    ["relative", path.join("fonts", "consolab.ttf")],
    ["missing", path.join(os.tmpdir(), "missing-study-overlay-font.ttf")],
  ])("rejects a %s Study overlay font path", (_label, fontPath) => {
    process.env.STUDY_OVERLAY_FONT = fontPath;
    expect(() => resolveStudyOverlayFontPath()).toThrow(
      new RegExp(`STUDY_OVERLAY_FONT.*${fontPath.replaceAll("\\", "\\\\")}`),
    );
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
