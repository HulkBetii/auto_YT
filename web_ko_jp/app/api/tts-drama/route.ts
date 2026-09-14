import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { updateVideoAudio } from "@/lib/db/repo/videos";

export const dynamic = "force-dynamic";
export const maxDuration = 900; // 15 minutes timeout for GPU drama TTS

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;
  try {
    const body = await request.json();
    const text = body.text?.trim();
    const videoId = typeof body.videoId === "number" ? body.videoId : undefined;
    const speed = typeof body.speed === "number" ? body.speed : 0.95;

    if (!text && !videoId) {
      return NextResponse.json({ ok: false, error: "Missing text or videoId to synthesize" }, { status: 400 });
    }

    const timestamp = Date.now();
    const fileName = videoId ? `drama_narration_${videoId}.wav` : `drama_${timestamp}.wav`;
    const rendersDir = path.join(process.cwd(), "data", "renders");
    if (!fs.existsSync(rendersDir)) {
      fs.mkdirSync(rendersDir, { recursive: true });
    }
    const outputPath = path.join(rendersDir, fileName);

    const scriptPath = path.join(process.cwd(), "scripts", "tts_gpt_sovits.py");

    const args = ["python", scriptPath, "--output", outputPath, "--speed", speed.toString()];

    if (videoId && !text) {
      args.push("--video_id", videoId.toString());
      console.log(`[api/tts-drama] Synthesizing video ID ${videoId} to ${fileName}...`);
    } else if (text) {
      tempFilePath = path.join(rendersDir, `temp_${timestamp}.txt`);
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

    return NextResponse.json({
      ok: true,
      fileName,
      audioUrl,
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