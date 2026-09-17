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

  // Look in output/ subfolders
  const baseDir = process.cwd();
  let filePath: string | null = null;

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
      console.warn("[api/subtitles] Error reading output dir:", e);
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Subtitle file not found" }, { status: 404 });
  }

  const srtContent = fs.readFileSync(filePath, "utf-8");

  return new NextResponse(srtContent, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
