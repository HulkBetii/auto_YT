import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createDrEpisode,
  formatRecentScenesForPrompt,
  listRecentSceneSummaries,
} from "@/lib/db/repo/episodes";
import { getDrConfigValue } from "@/lib/db/repo/channel-config";
import { DR_CONFIG_KEYS } from "@/lib/db/schema";
import { enqueueDrStage } from "@/lib/pipeline/createJob";
import { formatSceneInput, parseSceneInput } from "@/lib/pipeline/format";

export async function POST(request: Request) {
  const secret = process.env.DASHBOARD_SECRET;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  const bearer = request.headers.get("authorization");

  const authed = !secret || auth === secret || bearer === `Bearer ${secret}`;
  if (!authed) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { scene?: unknown };
    const manualScene = parseSceneInput(body.scene);

    // Manual override: a fully-specified scene starts directly at D1.
    if (manualScene) {
      const episode = await createDrEpisode({ status: "d1_pending", sceneInput: manualScene });
      await enqueueDrStage({
        promptKey: "D1",
        stage: "D1",
        vars: { SCENE_INPUT: formatSceneInput(manualScene) },
        episodeId: episode.id,
      });
      return NextResponse.json({ ok: true, episodeId: episode.id, mode: "manual" }, { status: 201 });
    }

    // Auto: D0 generates a scene (avoiding recent ones), then the chain continues.
    const episode = await createDrEpisode({ status: "d0_pending" });
    const recentScenes = await listRecentSceneSummaries(30, episode.id);
    const targetCount = (await getDrConfigValue(DR_CONFIG_KEYS.targetSceneCount)) || "5";

    await enqueueDrStage({
      promptKey: "D0",
      stage: "D0",
      vars: {
        RECENT_SCENES: formatRecentScenesForPrompt(recentScenes),
        TARGET_COUNT: targetCount,
      },
      episodeId: episode.id,
    });

    return NextResponse.json({ ok: true, episodeId: episode.id, mode: "auto" }, { status: 201 });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[videos/create]", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
