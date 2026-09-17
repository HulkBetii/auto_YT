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
    const sourceVideoId = extractYouTubeId(data.url) || undefined;
    try {
      const saved = await createCompletedDramaVideo({
        sourceUrl: data.url,
        sourceTitle: data.title,
        sourceVideoId,
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

    // Save consolidated artifacts into output/{folderName}/
    const namingParams = {
      videoId: videoId ?? undefined,
      sourceVideoId,
      sourceUrl: data.url,
      title: data.title || data.title_jp,
    };
    const folderName = getVideoFolderName(namingParams);
    const videoOutDir = path.join(process.cwd(), "output", folderName);

    try {
      if (!fs.existsSync(videoOutDir)) {
        fs.mkdirSync(videoOutDir, { recursive: true });
      }

      // 1. Save summary.txt
      const tagsBlock = data.youtube_tags ? `\n\nYouTube Tags (Comma-separated):\n${data.youtube_tags}` : "";
      const summaryContent = `Title (JP):\n${data.title_jp || ""}\n\nThumbnail Text:\n${data.thumbnail_text || ""}\n\nDescription & Chapters:\n${data.description_jp || ""}${tagsBlock}\n\nScript (JP):\n${data.script_jp || ""}`;
      const summaryPath = path.join(videoOutDir, buildSummaryTxtFilename(namingParams));
      fs.writeFileSync(summaryPath, summaryContent, "utf-8");

      // 2. Save data.json
      const fullData = {
        id: videoId,
        source_url: data.url,
        source_video_id: sourceVideoId,
        source_title: data.title,
        title_jp: data.title_jp,
        description_jp: data.description_jp,
        youtube_tags: data.youtube_tags || "",
        thumbnail_text: data.thumbnail_text,
        thumbnail_options: data.thumbnail_options,
        thumbnail_image_url: data.thumbnail_image_url,
        conversation_url: data.conversation_url,
        audio_url: data.audio_url,
        final_script_jp: data.script_jp,
        char_count: data.char_count,
        created_at: new Date().toISOString(),
      };
      const dataPath = path.join(videoOutDir, buildDataJsonFilename(namingParams));
      fs.writeFileSync(dataPath, JSON.stringify(fullData, null, 2), "utf-8");

      // 3. Copy thumbnail image if available in public/thumbnails
      if (data.thumbnail_image_url) {
        const thumbFileName = path.basename(data.thumbnail_image_url);
        const publicThumb = path.join(process.cwd(), "public", "thumbnails", thumbFileName);
        const destThumb = path.join(videoOutDir, buildThumbnailFilename(namingParams));
        if (fs.existsSync(publicThumb)) {
          fs.copyFileSync(publicThumb, destThumb);
        }
      }
      console.log(`[api/youtube-rewrite] Consolidated video artifacts saved to ${videoOutDir}`);
    } catch (saveErr) {
      console.warn("[api/youtube-rewrite] Failed to save consolidated artifacts:", saveErr);
    }

    return NextResponse.json({
      ok: true,
      data: {
        videoId,
        sourceVideoId,
        folderName,
        folderPath: videoOutDir,
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