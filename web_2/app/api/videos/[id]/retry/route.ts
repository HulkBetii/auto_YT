import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { listFailedAhJobsByVideo, retryAhJob } from "@/lib/db/repo/jobs";
import {
  formatRecentAhTopicsForPrompt,
  getAhVideo,
  listRecentAhTopicSummaries,
  updateAhVideoFields,
  updateAhVideoStatus,
} from "@/lib/db/repo/videos";
import type { AhVideoStatus } from "@/lib/db/schema";
import { enqueueAhStage } from "@/lib/pipeline/createJob";
import { smartBucketTranscript } from "@/lib/pipeline/tts";

const STAGE_TO_VIDEO_STATUS: Record<string, AhVideoStatus> = {
  S1: "s1_pending",
  S2: "s2_pending",
  S3: "s3_pending",
  S4: "s4_pending",
};

async function assertAuth(request: Request) {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  const bearer = request.headers.get("authorization");
  return !secret || auth === secret || bearer === `Bearer ${secret}`;
}

function getTopic(value: unknown): {
  title: string;
  angle: string;
  hook: string;
  key_questions: string[];
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const topic = value as Record<string, unknown>;
  if (
    typeof topic.title !== "string" ||
    typeof topic.angle !== "string" ||
    typeof topic.hook !== "string" ||
    !Array.isArray(topic.key_questions)
  ) {
    return null;
  }
  const keyQuestions = topic.key_questions.filter((item): item is string => typeof item === "string");
  return {
    title: topic.title,
    angle: topic.angle,
    hook: topic.hook,
    key_questions: keyQuestions,
  };
}

function isTtsTask(value: string | null): boolean {
  return !!value && (value.startsWith("tts_task:") || value.startsWith("tts_task_gx:") || value === "tts_submitting");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertAuth(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const videoId = parseInt(id, 10);
  if (isNaN(videoId)) {
    return NextResponse.json({ ok: false, error: "Invalid video ID" }, { status: 400 });
  }

  const video = await getAhVideo(videoId);
  if (!video) {
    return NextResponse.json({ ok: false, error: "Video not found" }, { status: 404 });
  }

  const failedJobs = await listFailedAhJobsByVideo(videoId);
  const latestFailedJob = failedJobs.sort((a, b) => b.id - a.id)[0];
  if (latestFailedJob) {
    const updated = await retryAhJob(latestFailedJob.id);
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Failed job can no longer be retried" }, { status: 409 });
    }
    const nextStatus = STAGE_TO_VIDEO_STATUS[updated.stage];
    if (nextStatus) await updateAhVideoStatus(videoId, nextStatus);
    return NextResponse.json({ ok: true, mode: "job", jobId: updated.id, status: nextStatus });
  }

  if (!video.chosenTopic) {
    const recentTopics = await listRecentAhTopicSummaries(30, video.id);
    await updateAhVideoStatus(videoId, "s1_pending");
    await enqueueAhStage({
      promptKey: "S1",
      stage: "S1",
      vars: {
        RECENT_TOPICS: formatRecentAhTopicsForPrompt(recentTopics),
      },
      videoId,
      metadata: { retry: "video" },
    });
    return NextResponse.json({ ok: true, mode: "video", status: "s1_pending" });
  }

  const topic = getTopic(video.chosenTopic);
  if (!video.script) {
    if (!topic) {
      return NextResponse.json({ ok: false, error: "Chosen topic is incomplete" }, { status: 409 });
    }
    await updateAhVideoStatus(videoId, "s2_pending");
    await enqueueAhStage({
      promptKey: "S2",
      stage: "S2",
      vars: {
        TOPIC_TITLE: topic.title,
        TOPIC_ANGLE: topic.angle,
        HOOK: topic.hook,
        KEY_QUESTIONS: topic.key_questions.join("\n"),
      },
      videoId,
      metadata: { retry: "video" },
    });
    return NextResponse.json({ ok: true, mode: "video", status: "s2_pending" });
  }

  if (!video.whisperTranscript || isTtsTask(video.audioUrl) || !video.audioUrl) {
    await updateAhVideoFields(videoId, {
      status: "tts_pending",
      audioUrl: isTtsTask(video.audioUrl) ? null : video.audioUrl,
      whisperTranscript: null,
      imagePrompts: null,
      ytTitle: null,
      ytDescription: null,
      ytTags: null,
      imageCount: 0,
      imageCountExpected: 0,
      videoPath: null,
    });
    return NextResponse.json({ ok: true, mode: "video", status: "tts_pending" });
  }

  if (!video.imagePrompts) {
    await updateAhVideoStatus(videoId, "s3_pending");
    await enqueueAhStage({
      promptKey: "S3",
      stage: "S3",
      vars: {
        TIMESTAMPED_SCRIPT: smartBucketTranscript(video.whisperTranscript),
        TOPIC_TITLE: topic?.title ?? "",
      },
      videoId,
      metadata: { retry: "video" },
    });
    return NextResponse.json({ ok: true, mode: "video", status: "s3_pending" });
  }

  if (!video.ytTitle || !video.ytDescription || !video.ytTags) {
    await updateAhVideoStatus(videoId, "s4_pending");
    await enqueueAhStage({
      promptKey: "S4",
      stage: "S4",
      vars: {
        TOPIC_TITLE: topic?.title ?? "",
        SCRIPT_EXCERPT: video.script.slice(0, 600),
      },
      videoId,
      metadata: { retry: "video" },
    });
    return NextResponse.json({ ok: true, mode: "video", status: "s4_pending" });
  }

  if (!video.videoPath) {
    await updateAhVideoFields(videoId, {
      status: "ready",
      imageCount: 0,
      videoPath: null,
    });
    return NextResponse.json({ ok: true, mode: "video", status: "ready" });
  }

  return NextResponse.json({ ok: false, error: "Video is already complete" }, { status: 409 });
}
