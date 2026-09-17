import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { updateVideoAudio, getKoJpVideo } from "@/lib/db/repo/videos";
import { buildDramaAudioFilename, extractYouTubeId, getVideoFolderName } from "@/lib/naming";

export const dynamic = "force-dynamic";
export const maxDuration = 900; // 15 minutes timeout for GPU drama TTS

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;
  try {
    const body = await request.json();
    const text = body.text?.trim();
    const videoId = typeof body.videoId === "number" ? body.videoId : undefined;
    const title = typeof body.title === "string" ? body.title.trim() : undefined;
    const sourceVideoId = typeof body.sourceVideoId === "string" ? body.sourceVideoId.trim() : undefined;
    const url = typeof body.url === "string" ? body.url.trim() : undefined;
    const speed = typeof body.speed === "number" ? body.speed : 0.95;

    if (!text && !videoId) {
      return NextResponse.json({ ok: false, error: "Missing text or videoId to synthesize" }, { status: 400 });
    }

    // Fetch DB record if videoId is provided to obtain metadata fallback
    let dbVideo = null;
    if (videoId) {
      try {
        dbVideo = await getKoJpVideo(videoId);
      } catch (e) {
        console.warn("[api/tts-drama] Could not fetch video from DB:", e);
      }
    }

    const finalTitle = title || dbVideo?.sourceTitle || dbVideo?.titleJp;
    const finalSourceVideoId =
      sourceVideoId || dbVideo?.sourceVideoId || extractYouTubeId(url || dbVideo?.sourceUrl);
    const finalSourceUrl = url || dbVideo?.sourceUrl;

    const timestamp = Date.now();
    const namingParams = {
      videoId,
      sourceVideoId: finalSourceVideoId,
      sourceUrl: finalSourceUrl,
      title: finalTitle,
      timestamp,
    };
    const fileName = buildDramaAudioFilename(namingParams);
    const folderName = getVideoFolderName(namingParams);

    const videoOutDir = path.join(process.cwd(), "output", folderName);
    if (!fs.existsSync(videoOutDir)) {
      fs.mkdirSync(videoOutDir, { recursive: true });
    }
    const outputPath = path.join(videoOutDir, fileName);

    const scriptPath = path.join(process.cwd(), "scripts", "tts_gpt_sovits.py");

    const args = ["python", scriptPath, "--output", outputPath, "--speed", speed.toString()];
    if (finalTitle) {
      args.push("--title", finalTitle);
    }
    if (finalSourceVideoId) {
      args.push("--source_video_id", finalSourceVideoId);
    }
    if (finalSourceUrl) {
      args.push("--source_url", finalSourceUrl);
    }

    if (videoId && !text) {
      args.push("--video_id", videoId.toString());
      console.log(`[api/tts-drama] Synthesizing video ID ${videoId} to ${fileName}...`);
    } else if (text) {
      tempFilePath = path.join(videoOutDir, `temp_${timestamp}.txt`);
      fs.writeFileSync(tempFilePath, text, "utf-8");
      args.push("--text_file", tempFilePath);
      if (videoId) {
        args.push("--video_id", videoId.toString());
      }
      console.log(`[api/tts-drama] Synthesizing ${text.length} chars to ${fileName}...`);
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(args[0], args.slice(1), { cwd: process.cwd() });

      let stderr = "";
      child.stdout.on("data", (data) => {
        console.log(`[tts-drama stdout] ${data}`);
      });
      child.stderr.on("data", (data) => {
        stderr += data.toString();
        console.log(`[tts-drama stderr] ${data}`);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`TTS generation failed with exit code ${code}: ${stderr}`));
        }
      });

      child.on("error", (err) => {
        reject(err);
      });
    });

    const audioUrl = `/api/audio?file=${fileName}`;

    if (videoId) {
      try {
        await updateVideoAudio(videoId, audioUrl, outputPath);
        console.log(`[api/tts-drama] Updated DB for video ID ${videoId} with audioUrl ${audioUrl}`);
      } catch (dbErr) {
        console.warn(`[api/tts-drama] Failed to update DB:`, dbErr);
      }
    }

    const srtFileName = `sub_${folderName}.srt`;
    const srtUrl = `/api/subtitles?file=${encodeURIComponent(srtFileName)}`;

    return NextResponse.json({
      ok: true,
      fileName,
      folderName,
      folderPath: videoOutDir,
      audioUrl,
      srtFileName,
      srtUrl,
    });
  } catch (err: any) {
    console.error("[api/tts-drama]", err);
    return NextResponse.json({ ok: false, error: err.message || String(err) }, { status: 500 });
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (_) {}
    }
  }
}