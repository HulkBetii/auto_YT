import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { createCompletedDramaVideo } from "@/lib/db/repo/videos";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 minutes timeout for deep thinking 5-turn pipeline

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = body.url?.trim();
    const action = body.action || "generate"; // "extract" | "generate"
    const customPrompt = body.customPrompt?.trim();

    if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
      return NextResponse.json({ ok: false, error: "Vui lòng nhập link YouTube hợp lệ." }, { status: 400 });
    }

    const scriptsDir = path.join(process.cwd(), "scripts");

    if (action === "extract") {
      const scriptPath = path.join(scriptsDir, "youtube_extractor.py");
      console.log(`[api/youtube-rewrite] Extracting YouTube metadata for ${url}...`);

      const resultJson = await new Promise<string>((resolve, reject) => {
        const child = spawn("python", [scriptPath, url], { cwd: process.cwd() });
        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => {
          stdout += data.toString();
        });
        child.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        child.on("close", (code) => {
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(`Extraction failed (code ${code}): ${stderr}`));
          }
        });

        child.on("error", (err) => reject(err));
      });

      const parsed = JSON.parse(resultJson);
      return NextResponse.json({ ok: true, data: parsed });
    }

    // Default action: "generate"
    const pipelineScript = path.join(scriptsDir, "chatgpt_drama_pipeline.py");
    console.log(`[api/youtube-rewrite] Running ChatGPT High pipeline for ${url}...`);

    const resultJson = await new Promise<string>((resolve, reject) => {
      const child = spawn("python", [pipelineScript, url], { cwd: process.cwd() });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data) => {
        stderr += data.toString();
        console.log(`[pipeline stderr] ${data}`);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Pipeline failed (code ${code}): ${stderr}`));
        }
      });

      child.on("error", (err) => reject(err));
    });

    // Locate the JSON block in stdout
    const jsonMatch = resultJson.match(/\{[\s\S]*"script_jp"[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Could not parse JSON response from pipeline: ${resultJson}`);
    }

    const data = JSON.parse(jsonMatch[0]);

    // Save to Postgres Database
    let videoId: number | null = null;
    try {
      const saved = await createCompletedDramaVideo({
        sourceUrl: data.url,
        sourceTitle: data.title,
        transcriptText: body.transcript || "",
        finalScriptJp: data.script_jp,
        titleJp: data.title_jp,
        descriptionJp: data.description_jp,
        thumbnailText: data.thumbnail_text,
        thumbnailOptions: data.thumbnail_options,
        thumbnailImageUrl: data.thumbnail_image_url,
        conversationUrl: data.conversation_url,
        audioUrl: data.audio_url,
        status: "ready",
      });
      videoId = saved.id;
    } catch (dbErr) {
      console.warn("[api/youtube-rewrite] DB save warning:", dbErr);
    }

    return NextResponse.json({
      ok: true,
      data: {
        videoId,
        title: data.title,
        url: data.url,
        conversationUrl: data.conversation_url,
        titleJp: data.title_jp,
        scriptJp: data.script_jp,
        descriptionJp: data.description_jp,
        thumbnailText: data.thumbnail_text,
        thumbnailOptions: data.thumbnail_options,
        thumbnailImageUrl: data.thumbnail_image_url,
        audioUrl: data.audio_url,
        charCount: data.char_count,
      },
    });
  } catch (err: any) {
    console.error("[api/youtube-rewrite]", err);
    return NextResponse.json({ ok: false, error: err.message || String(err) }, { status: 500 });
  }
}