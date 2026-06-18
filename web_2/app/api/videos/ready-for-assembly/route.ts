import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/utils/auth";
import { listAhVideos } from "@/lib/db/repo/videos";
import { getManualImageProjectInfo } from "@/lib/manual-image-project";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const videos = await listAhVideos({ status: "ready" });

  return NextResponse.json(
    videos.map((v) => {
      const manualProject = getManualImageProjectInfo(v);
      return {
        id: v.id,
        scriptSlug: v.scriptSlug,
        audioUrl: v.audioUrl,
        imagePromptsLength: v.imagePrompts?.length ?? 0,
        ...manualProject,
      };
    })
  );
}
