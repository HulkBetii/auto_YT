import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileName = searchParams.get("file");

  if (!fileName || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    return NextResponse.json({ error: "Invalid file parameter" }, { status: 400 });
  }

  // Look in output/ subfolders, data/renders, or data/voices
  const baseDir = process.cwd();
  let filePath: string | null = null;

  // 1. Check inside output/ video folders
  const outputDir = path.join(baseDir, "output");
  if (fs.existsSync(outputDir)) {
    try {
      const subdirs = fs.readdirSync(outputDir, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const d of subdirs) {
        const candidate = path.join(outputDir, d.name, fileName);
        if (fs.existsSync(candidate)) {
          filePath = candidate;
          break;
        }
      }
    } catch (e) {
      console.warn("[api/audio] Error reading output dir:", e);
    }
  }

  // 2. Check legacy data/renders
  if (!filePath) {
    const rendersPath = path.join(baseDir, "data", "renders", fileName);
    if (fs.existsSync(rendersPath)) {
      filePath = rendersPath;
    }
  }

  // 3. Check data/voices
  if (!filePath) {
    const voicesPath = path.join(baseDir, "data", "voices", fileName);
    if (fs.existsSync(voicesPath)) {
      filePath = voicesPath;
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = request.headers.get("range");

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });

    return new NextResponse(stream as any, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize.toString(),
        "Content-Type": "audio/wav",
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new NextResponse(stream as any, {
    status: 200,
    headers: {
      "Content-Length": fileSize.toString(),
      "Content-Type": "audio/wav",
      "Cache-Control": "public, max-age=3600",
    },
  });
}