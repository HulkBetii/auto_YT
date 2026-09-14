import { describe, expect, it } from "vitest";

import {
  assertKoreanTranscript,
  getHangulLetterRatio,
  parseTranscriptJsonArtifact,
  parseTranscriptText,
  selectTranscriptSegments,
  type TranscriptJob,
} from "@/lib/pipeline/yt-pro-max";
import { renderTimestampedTranscript } from "@/lib/pipeline/storage";

const baseJob = {
  id: "job-1",
  status: "completed",
  progress: 100,
  language: "ko",
} as TranscriptJob;

describe("YT_Pro_Max transcript contract", () => {
  it("parses the required title and body format", () => {
    expect(parseTranscriptText("Title: 복이 들어오는 집\n\n현관의 기운을 바로잡으십시오.\n")).toEqual({
      title: "복이 들어오는 집",
      body: "현관의 기운을 바로잡으십시오.",
    });
  });

  it("rejects missing title headers and non-Korean jobs", () => {
    expect(() => parseTranscriptText("현관의 기운을 바로잡으십시오.")).toThrow();
    expect(() => assertKoreanTranscript({ ...baseJob, language: "en" }, "한국어 내용입니다.")).toThrow();
  });

  it("requires a predominantly Korean transcript", () => {
    expect(getHangulLetterRatio("당신의 복이 들어옵니다.")).toBeGreaterThan(0.8);
    expect(() => assertKoreanTranscript(baseJob, "This is almost entirely English text.")).toThrow();
  });

  it("parses timestamped JSON segments for source auditing", () => {
    const artifact = parseTranscriptJsonArtifact({
      video: { id: "abc", title: "소금 제목", duration_seconds: 20 },
      segments: [
        { index: 1, start_ms: 0, end_ms: 1200, text: "첫 문장입니다." },
        { index: 2, start_ms: 1500, end_ms: 3100, text: "둘째 문장입니다." },
      ],
    });
    expect(renderTimestampedTranscript(artifact)).toContain(
      "[SEGMENT 0002 | 00:01.500-00:03.100] 둘째 문장입니다.",
    );
  });

  it("cuts the salt video before the appended ancestor-table topic", () => {
    const artifact = parseTranscriptJsonArtifact({
      video: { id: "1FR9vF54BOk", title: "소금 제목", duration_seconds: 1200 },
      segments: Array.from({ length: 205 }, (_, offset) => ({
        index: offset + 1,
        start_ms: offset * 1000,
        end_ms: offset * 1000 + 900,
        text:
          offset < 199
            ? "천일염으로 재물운을 지키는 내용입니다."
            : offset === 199
              ? "그리고 이어서 다음 주제를 공유하겠습니다."
              : "제사상에 이 음식 절대 올리지 마세요.",
      })),
    });
    const cleaned = selectTranscriptSegments(artifact, 1, 199).map((segment) => segment.text).join(" ");
    expect(cleaned).toContain("천일염");
    expect(cleaned).not.toContain("제사상");
    expect(cleaned).not.toContain("이어서 다음 주제");
  });
});
