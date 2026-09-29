import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { createCompletedDramaVideo } from "@/lib/db/repo/videos";
import {
  extractYouTubeId,
  getVideoFolderName,
  buildSummaryTxtFilename,
  buildDataJsonFilename,
  buildThumbnailFilename,
} from "@/lib/naming";

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
    const pipelineScript = path.join(scriptsDir, "run_pipeline.py");
    console.log(`[api/youtube-rewrite] Running Master 8-Stage Pipeline for ${url}...`);

    const resultJson = await new Promise<string>((resolve, reject) => {
      const child = spawn("python", [pipelineScript, url], { cwd: process.cwd() });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
        process.stdout.write(data);
      });
      child.stderr.on("data", (data) => {
        stderr += data.toString();
        process.stderr.write(data);
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

    // Locate the JSON result block in stdout
    const jsonMatch = resultJson.match(/\{[\s\S]*"upload_kit_path"[\s\S]*\}/) || resultJson.match(/\{[\s\S]*"video_id"[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Could not parse JSON result from master pipeline: ${resultJson}`);
    }

    const data = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      ok: true,
      data: {
        videoId: data.video_id,
        folderPath: data.folder_path,
        uploadKitPath: data.upload_kit_path,
        titleA: data.title_a,
        titleB: data.title_b,
        titleC: data.title_c,
        elapsedSeconds: data.elapsed_seconds,
      },
    });
  } catch (err: any) {
    console.error("[api/youtube-rewrite]", err);
    return NextResponse.json({ ok: false, error: err.message || String(err) }, { status: 500 });
  }
}