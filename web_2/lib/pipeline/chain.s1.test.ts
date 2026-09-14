import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueAhStage: vi.fn(),
  updateAhVideoFields: vi.fn(),
  updateAhVideoStatus: vi.fn(),
}));

vi.mock("@/lib/db/repo/jobs", () => ({
  hasOpenAhJobForVideoStage: vi.fn(),
  listUnconsumedDoneAhJobs: vi.fn(),
  listUnconsumedFailedAhJobs: vi.fn(),
  markAhJobConsumed: vi.fn(),
  markAhJobHandlerFailed: vi.fn(),
  resetStaleRunningAhJobs: vi.fn(),
}));
vi.mock("@/lib/db/repo/videos", () => ({
  getAhVideo: vi.fn(),
  listAhVideos: vi.fn(),
  updateAhVideoFields: mocks.updateAhVideoFields,
  updateAhVideoStatus: mocks.updateAhVideoStatus,
}));
vi.mock("@/lib/notifications", () => ({ notify: vi.fn() }));
vi.mock("@/lib/manual-image-project", () => ({ getManualImageProjectInfo: vi.fn() }));
vi.mock("@/lib/config/channel", () => ({ channelConfig: {} }));
vi.mock("@/lib/db/repo/channel-config", () => ({
  getAhConfigValue: vi.fn(),
  setAhConfigValue: vi.fn(),
}));
vi.mock("./createJob", () => ({ enqueueAhStage: mocks.enqueueAhStage }));
vi.mock("./descriptionBuilder", () => ({
  buildDescription: vi.fn(),
  computeChapterTimestamps: vi.fn(),
  fmtChapterTime: vi.fn(),
  normalizeUrlSlug: vi.fn(),
  normalizeVideoSpecificTags: vi.fn(),
  parseS4Variable: vi.fn(),
  parseWhisperSegments: vi.fn(),
}));
vi.mock("./tts", () => ({
  describePendingTtsWait: vi.fn(),
  runTTSAndWhisperForPendingVideo: vi.fn(),
  smartBucketTranscript: vi.fn(),
}));
vi.mock("./visualStyle", () => ({
  formatImagePrompts: vi.fn(),
  formatThumbnailConcept: vi.fn(),
}));
vi.mock("./bgm", () => ({ runBgmForPendingVideos: vi.fn() }));

import { handleS1Done, handleS2Done, sanitizeS2ScriptOutput } from "./chain";

function topic(title: string) {
  return {
    title,
    head_keyword: title.toLowerCase(),
    angle: `${title} angle`,
    hook: `${title} hook`,
    viral_type: "what_how",
    key_questions: ["One?", "Two?", "Three?"],
  };
}

describe("handleS1Done", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the Playwright recommended candidate when enqueueing S2", async () => {
    await handleS1Done({
      id: 41,
      videoId: 7,
      result: JSON.stringify({
        candidates: [topic("First"), topic("Second")],
        recommended_index: 2,
      }),
    } as never);

    expect(mocks.updateAhVideoFields).toHaveBeenCalledWith(7, expect.objectContaining({
      chosenTopic: expect.objectContaining({ title: "Second" }),
    }));
    expect(mocks.updateAhVideoStatus).toHaveBeenCalledWith(7, "s2_pending");
    expect(mocks.enqueueAhStage).toHaveBeenCalledWith(expect.objectContaining({
      promptKey: "S2",
      stage: "S2",
      videoId: 7,
      causedByJobId: 41,
      vars: expect.objectContaining({ TOPIC_TITLE: "Second" }),
    }));
  });
});

describe("handleS2Done", () => {
  beforeEach(() => vi.clearAllMocks());

  it("strips leading ChatGPT UI artifacts before saving script", async () => {
    await handleS2Done({
      id: 61,
      videoId: 13,
      result: "Edit\n\nYou picture smoking as a private habit.\n\nThe story begins here.",
    } as never);

    expect(mocks.updateAhVideoFields).toHaveBeenCalledWith(13, expect.objectContaining({
      script: "You picture smoking as a private habit.\n\nThe story begins here.",
      scriptSlug: "you_picture_smoking_as_a_private_habit",
    }));
    expect(mocks.updateAhVideoStatus).toHaveBeenCalledWith(13, "tts_pending");
  });
});

describe("sanitizeS2ScriptOutput", () => {
  it("keeps normal narration unchanged", () => {
    expect(sanitizeS2ScriptOutput("You start beside a fire.")).toBe("You start beside a fire.");
  });
});
