import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createStudyInputSignature,
  isSixteenByNine,
  naturalSort,
  parseFrameRate,
  requiredFreeBytes,
  scanStudyAudioTracks,
} from "./media";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("study media helpers", () => {
  it("sorts numbered footage and tracks naturally", () => {
    expect(naturalSort(["track-10.mp3", "track-2.mp3", "track-01.mp3"])).toEqual([
      "track-01.mp3",
      "track-2.mp3",
      "track-10.mp3",
    ]);
  });

  it("uses deterministic punctuation ordering shared with the Python worker", () => {
    expect(
      naturalSort([
        "track_2.mp3",
        "track-10.mp3",
        "track 1.mp3",
        "Track.3.mp3",
        "track(4).mp3",
      ]),
    ).toEqual([
      "track 1.mp3",
      "track(4).mp3",
      "track-10.mp3",
      "Track.3.mp3",
      "track_2.mp3",
    ]);
  });

  it("accepts 16:9 within two percent and rejects portrait video", () => {
    expect(isSixteenByNine(1920, 1080)).toBe(true);
    expect(isSixteenByNine(1910, 1080)).toBe(true);
    expect(isSixteenByNine(1080, 1920)).toBe(false);
  });

  it("parses fractional frame rates", () => {
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFrameRate("30/1")).toBe(30);
    expect(parseFrameRate("0/0")).toBe(0);
  });

  it("uses the 2.5x disk-space safety factor", () => {
    expect(requiredFreeBytes(101)).toBe(253);
  });

  it("creates deterministic signatures and includes track order", () => {
    const base = {
      dayNumber: 1,
      weekNumber: 1,
      footageSha256s: ["a", "b"],
      trackSha256s: ["c", "d"],
    };
    expect(createStudyInputSignature(base)).toBe(createStudyInputSignature(base));
    expect(createStudyInputSignature(base)).not.toBe(
      createStudyInputSignature({ ...base, trackSha256s: ["d", "c"] }),
    );
    expect(createStudyInputSignature(base)).toBe(
      "4eeb8138cbd0addca0959929d0eeb2a520aff646b7c49d97a240ff4ca7faad1c",
    );
    expect(createStudyInputSignature(base)).not.toBe(
      createStudyInputSignature(base, "study-pomodoro-v2"),
    );
  });

  it("rejects an audio folder unless it contains exactly 20 MP3 files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "study-media-"));
    tempDirs.push(root);
    for (let index = 1; index <= 19; index += 1) {
      await writeFile(path.join(root, `${index}.mp3`), "fixture");
    }
    await expect(scanStudyAudioTracks(root, root)).rejects.toThrow("exactly 20 MP3 files");
  });
});
