import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { listFailedDrJobsByEpisode, retryDrJob } from "@/lib/db/repo/jobs";
import {
  formatRecentScenesForPrompt,
  getDrEpisode,
  listRecentSceneSummaries,
  updateDrEpisodeStatus,
} from "@/lib/db/repo/episodes";
import { getDrConfigValue } from "@/lib/db/repo/channel-config";
import { DR_CONFIG_KEYS, type DrEpisodeStatus, type SceneInput } from "@/lib/db/schema";
import { enqueueDrStage } from "@/lib/pipeline/createJob";
import { STAGE_TO_EPISODE_STATUS, formatSceneInput } from "@/lib/pipeline/format";

async function assertAuth(request: Request) {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  const bearer = request.headers.get("authorization");
  return !secret || auth === secret || bearer === `Bearer ${secret}`;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertAuth(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const episodeId = parseInt(id, 10);
  if (isNaN(episodeId)) {
    return NextResponse.json({ ok: false, error: "Invalid episode ID" }, { status: 400 });
  }

  const episode = await getDrEpisode(episodeId);
  if (!episode) {
    return NextResponse.json({ ok: false, error: "Episode not found" }, { status: 404 });
  }

  // Preferred path: re-run the most recent failed job for this episode.
  const failedJobs = await listFailedDrJobsByEpisode(episodeId);
  const latestFailedJob = failedJobs.sort((a, b) => b.id - a.id)[0];
  if (latestFailedJob) {
    const updated = await retryDrJob(latestFailedJob.id);
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Failed job can no longer be retried" }, { status: 409 });
    }
    const status = STAGE_TO_EPISODE_STATUS[updated.stage];
    if (status) await updateDrEpisodeStatus(episodeId, status as DrEpisodeStatus);
    return NextResponse.json({ ok: true, mode: "job", jobId: updated.id, status });
  }

  // Fallback: re-enqueue from the visual stage (or scene generation if no scene yet).
  const scene = episode.sceneInput as SceneInput | null;
  if (scene) {
    await updateDrEpisodeStatus(episodeId, "d1_pending");
    await enqueueDrStage({
      promptKey: "D1",
      stage: "D1",
      vars: { SCENE_INPUT: formatSceneInput(scene) },
      episodeId,
      metadata: { retry: "episode" },
    });
    return NextResponse.json({ ok: true, mode: "episode", status: "d1_pending" });
  }

  const recentScenes = await listRecentSceneSummaries(30, episodeId);
  const targetCount = (await getDrConfigValue(DR_CONFIG_KEYS.targetSceneCount)) || "5";
  await updateDrEpisodeStatus(episodeId, "d0_pending");
  await enqueueDrStage({
    promptKey: "D0",
    stage: "D0",
    vars: { RECENT_SCENES: formatRecentScenesForPrompt(recentScenes), TARGET_COUNT: targetCount },
    episodeId,
    metadata: { retry: "episode" },
  });
  return NextResponse.json({ ok: true, mode: "episode", status: "d0_pending" });
}
