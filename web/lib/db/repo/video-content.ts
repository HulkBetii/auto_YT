import { and, eq } from "drizzle-orm";

import { db } from "../index";
import { videoContent, type contentStageEnum } from "../schema";

type ContentStage = (typeof contentStageEnum.enumValues)[number];

export async function saveVideoContent(input: {
  videoId: number;
  stage: ContentStage;
  output: string;
  promptVersionId?: number;
}) {
  const [created] = await db
    .insert(videoContent)
    .values({
      videoId: input.videoId,
      stage: input.stage,
      output: input.output,
      promptVersionId: input.promptVersionId,
    })
    .returning();
  return created;
}

/** Latest output for a given (video, stage) — used to build the next stage's prompt vars. */
export async function getLatestVideoContent(videoId: number, stage: ContentStage) {
  const rows = await db
    .select()
    .from(videoContent)
    .where(and(eq(videoContent.videoId, videoId), eq(videoContent.stage, stage)))
    .orderBy(videoContent.createdAt);
  return rows.at(-1) ?? null;
}
