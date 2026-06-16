import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateVideoProgress } from "@/lib/db/repo/videos";
import { AH_STATUSES } from "@/lib/db/schema";

const ASSEMBLY_STATUSES = ["image_gen_pending", "assembly_pending", "assembly_done", "needs_attention"] as const;

const BodySchema = z.object({
  status: z.enum(ASSEMBLY_STATUSES),
  imageCount: z.number().int().min(0).optional(),
  imageCountExpected: z.number().int().min(0).optional(),
  videoPath: z.string().optional(),
});

function assertAuth(request: NextRequest): boolean {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return true;
  const bearer = request.headers.get("authorization");
  return bearer === `Bearer ${secret}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!assertAuth(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const videoId = parseInt(id, 10);
  if (isNaN(videoId)) {
    return NextResponse.json({ ok: false, error: "Invalid video id" }, { status: 400 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  await updateVideoProgress(videoId, {
    status: body.status,
    imageCount: body.imageCount,
    imageCountExpected: body.imageCountExpected,
    videoPath: body.videoPath,
  });

  return NextResponse.json({ ok: true, videoId, status: body.status });
}
