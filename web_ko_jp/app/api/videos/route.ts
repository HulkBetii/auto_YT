import { NextRequest, NextResponse } from "next/server";
import { createKoJpVideo, updateKoJpVideo } from "@/lib/db/repo/videos";
import { advanceVideoPipeline } from "@/lib/pipeline/chain";

export async function POST(req: NextRequest) {
  try {
    let sourceUrl = "";
    let sourceTitle = "";
    let sourceLanguage = "ko";
    let targetLanguage = "jp";
    let adaptationMode = "philosophical_insight";
    let transcriptText = "";

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      sourceUrl = (formData.get("sourceUrl") as string) || "";
      sourceTitle = (formData.get("sourceTitle") as string) || "";
      sourceLanguage = (formData.get("sourceLanguage") as string) || "ko";
      targetLanguage = (formData.get("targetLanguage") as string) || "jp";
      adaptationMode = (formData.get("adaptationMode") as string) || "philosophical_insight";
      transcriptText = (formData.get("transcriptText") as string) || "";
    } else {
      const body = await req.json();
      sourceUrl = body.sourceUrl || "";
      sourceTitle = body.sourceTitle || "";
      sourceLanguage = body.sourceLanguage || "ko";
      targetLanguage = body.targetLanguage || "jp";
      adaptationMode = body.adaptationMode || "philosophical_insight";
      transcriptText = body.transcriptText || "";
    }

    if (!sourceUrl) {
      return NextResponse.json({ error: "sourceUrl is required" }, { status: 400 });
    }

    const video = await createKoJpVideo({
      sourceUrl,
      sourceTitle: sourceTitle || undefined,
      sourceLanguage,
      targetLanguage,
      adaptationMode,
    });

    if (transcriptText) {
      await updateKoJpVideo(video.id, { transcriptText });
      await advanceVideoPipeline(video.id);
    }

    if (contentType.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(new URL("/", req.url), 303);
    }

    return NextResponse.json({ success: true, video });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
