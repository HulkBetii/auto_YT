import { describe, expect, it } from "vitest";

import { buildBgmPlan, parseSunoTaskResult, type SunoTaskResponse } from "./bgm";

const baseVideo = {
  chosenTopic: {
    title: "Why Your Body Still Fears Snakes",
    angle: "A modern fear that may come from ancient survival pressure.",
    hook: "Your body reacts before your mind has an opinion.",
  },
  script:
    "You see a thin shape on the ground and your body reacts before you decide what it is.",
  ytChapters: [
    { time: "00:00", title: "The instant reaction" },
    { time: "04:20", title: "Ancient pressure" },
  ],
};

describe("buildBgmPlan", () => {
  it("builds three short instrumental Suno prompts", () => {
    const plan = buildBgmPlan({
      ...baseVideo,
      promptSetVersion: "2.1-Mack-YT",
    });

    expect(plan.zones).toHaveLength(3);
    for (const zone of plan.zones) {
      expect(zone.prompt.length).toBeLessThanOrEqual(500);
      expect(zone.prompt).toContain("Instrumental only");
      expect(zone.prompt).toContain("no vocals");
      expect(zone.prompt).toContain("no lyrics");
      expect(zone.prompt).toContain("no choir");
      expect(zone.prompt).toContain("no humming");
      expect(zone.prompt).toContain("Seamless loop");
      expect(zone.prompt).toContain("narration-friendly");
    }
  });

  it("uses different vibe language per prompt set", () => {
    const mack = buildBgmPlan({ ...baseVideo, promptSetVersion: "2.1-Mack-YT" });
    const stickly = buildBgmPlan({ ...baseVideo, promptSetVersion: "2.2-Stickly-YT" });
    const explain = buildBgmPlan({ ...baseVideo, promptSetVersion: "2.3-Explain-In-Paint-YT" });

    expect(mack.zones[1].prompt).toContain("ancient-human");
    expect(stickly.zones[1].prompt).toContain("behavior");
    expect(stickly.zones[1].prompt).toContain("species");
    expect(explain.zones[1].prompt).toContain("mechanism");
    expect(new Set([mack.zones[1].prompt, stickly.zones[1].prompt, explain.zones[1].prompt]).size).toBe(3);
  });
});

describe("parseSunoTaskResult", () => {
  it("prefers metadata audio_url", () => {
    const task: SunoTaskResponse = {
      id: "task-1",
      status: "done",
      credit_cost: 3600,
      metadata: {
        audio_url: "https://cdn.example/main.mp3",
        all_audio_urls: ["https://cdn.example/alt.mp3"],
        suno_result: {
          clips: [{ audio_url: "https://cdn.example/clip.mp3", duration: 181.5 }],
        },
      },
    };

    expect(parseSunoTaskResult(task)).toEqual({
      status: "done",
      audioUrl: "https://cdn.example/main.mp3",
      duration: 181.5,
      creditCost: 3600,
    });
  });

  it("falls back to all_audio_urls and clip audio_url", () => {
    expect(
      parseSunoTaskResult({
        status: "done",
        metadata: { all_audio_urls: ["https://cdn.example/all.mp3"] },
      }),
    ).toMatchObject({ status: "done", audioUrl: "https://cdn.example/all.mp3" });

    expect(
      parseSunoTaskResult({
        status: "done",
        metadata: {
          suno_result: {
            clips: [{ audio_url: "https://cdn.example/clip.mp3", duration: 202 }],
          },
        },
      }),
    ).toMatchObject({ status: "done", audioUrl: "https://cdn.example/clip.mp3", duration: 202 });
  });

  it("returns error when completed task has no final audio", () => {
    expect(parseSunoTaskResult({ id: "task-2", status: "done", metadata: {} })).toMatchObject({
      status: "error",
      errorMessage: "Suno task task-2 done but no audio_url",
    });
  });
});
