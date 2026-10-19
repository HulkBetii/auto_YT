import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { db } from "@/lib/db";
import { koJpYoutubeUploads } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes timeout for browser upload automation

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const videoIdStr = searchParams.get("videoId");
    if (!videoIdStr) {
      return NextResponse.json({ ok: false, error: "Missing videoId parameter" }, { status: 400 });
    }

    const videoId = parseInt(videoIdStr, 10);
    if (isNaN(videoId)) {
      return NextResponse.json({ ok: false, error: "Invalid videoId" }, { status: 400 });
    }

    const upload = await db.query.koJpYoutubeUploads.findFirst({
      where: eq(koJpYoutubeUploads.videoId, videoId),
      orderBy: [desc(koJpYoutubeUploads.id)],
    });

    return NextResponse.json({
      ok: true,
      upload: upload || null,
      studioUrl: upload?.youtubeVideoId
        ? `https://studio.youtube.com/video/${upload.youtubeVideoId}/edit`
        : null,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action || "upload"; // "upload" | "approve" | "status"
    const videoId = parseInt(body.videoId, 10);
    const ackWarn = Boolean(body.ackWarn);
    const forceNew = Boolean(body.forceNew);
    const mode = body.mode || "next_slot"; // "next_slot" | "public_now" | "at"
    const atIso = body.atIso;

    if (isNaN(videoId)) {
      return NextResponse.json({ ok: false, error: "Invalid or missing videoId" }, { status: 400 });
    }

    const rootDir = path.resolve(process.cwd(), "..");
    const uploadScript = path.join(process.cwd(), "scripts", "youtube_upload.py");

    const args: string[] = ["run", "python", uploadScript];

    if (action === "upload") {
      args.push("upload", "--video_id", String(videoId));
      if (ackWarn) args.push("--ack-warn");
      if (forceNew) args.push("--force-new");
    } else if (action === "approve") {
      args.push("approve", "--video_id", String(videoId));
      if (mode === "public_now") {
        args.push("--public-now");
      } else if (mode === "at" && atIso) {
        args.push("--at", atIso);
      } else {
        args.push("--next-slot");
      }
    } else if (action === "status") {
      args.push("status", "--video_id", String(videoId));
    } else {
      return NextResponse.json({ ok: false, error: `Unsupported action '${action}'` }, { status: 400 });
    }

    console.log(`[api/youtube-upload] Running: uv ${args.join(" ")} in ${rootDir}`);

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn("uv", args, { cwd: rootDir });
        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => {
          const str = data.toString();
          stdout += str;
          process.stdout.write(str);
        });

        child.stderr.on("data", (data) => {
          const str = data.toString();
          stderr += str;
          process.stderr.write(str);
        });

        child.on("close", (code) => {
          resolve({ code: code ?? 1, stdout, stderr });
        });

        child.on("error", (err) => {
          resolve({ code: 1, stdout, stderr: err.message });
        });
      }
    );

    // Fetch updated record from DB
    const latestUpload = await db.query.koJpYoutubeUploads.findFirst({
      where: eq(koJpYoutubeUploads.videoId, videoId),
      orderBy: [desc(koJpYoutubeUploads.id)],
    });

    return NextResponse.json({
      ok: result.code === 0,
      exitCode: result.code,
      upload: latestUpload || null,
      studioUrl: latestUpload?.youtubeVideoId
        ? `https://studio.youtube.com/video/${latestUpload.youtubeVideoId}/edit`
        : null,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
