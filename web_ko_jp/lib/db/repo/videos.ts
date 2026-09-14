import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { koJpVideos, koJpSections, type KoJpVideo, type KoJpSection, type KoJpVideoStatus } from "@/lib/db/schema";

export async function createKoJpVideo(data: {
  sourceUrl: string;
  sourceVideoId?: string;
  sourceTitle?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  adaptationMode?: string;
  sourceAuditPromptVersionId?: number;
  outlinePromptVersionId?: number;
  scriptPromptVersionId?: number;
  reviewPromptVersionId?: number;
}): Promise<KoJpVideo> {
  const [inserted] = await db.insert(koJpVideos).values(data).returning();
  return inserted;
}

export async function getKoJpVideo(id: number): Promise<KoJpVideo | null> {
  const [row] = await db.select().from(koJpVideos).where(eq(koJpVideos.id, id)).limit(1);
  return row ?? null;
}

export async function listKoJpVideos(limit = 50): Promise<KoJpVideo[]> {
  return db.select().from(koJpVideos).orderBy(desc(koJpVideos.createdAt)).limit(limit);
}

export async function updateKoJpVideo(
  id: number,
  data: Partial<Omit<KoJpVideo, "id" | "createdAt">> & { status?: KoJpVideoStatus },
): Promise<KoJpVideo> {
  const [updated] = await db
    .update(koJpVideos)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(koJpVideos.id, id))
    .returning();
  return updated;
}

export async function listKoJpSections(videoId: number): Promise<KoJpSection[]> {
  return db
    .select()
    .from(koJpSections)
    .where(eq(koJpSections.videoId, videoId))
    .orderBy(koJpSections.sectionIndex);
}

export async function createCompletedDramaVideo(data: {
  sourceUrl: string;
  sourceTitle: string;
  sourceVideoId?: string;
  transcriptText: string;
  finalScriptJp: string;
  titleJp?: string;
  descriptionJp?: string;
  thumbnailText?: string;
  thumbnailOptions?: any;
  thumbnailImageUrl?: string;
  conversationUrl?: string;
  audioUrl?: string;
  audioPath?: string;
  audioDuration?: number;
  adaptationMode?: string;
  status?: KoJpVideoStatus;
}): Promise<KoJpVideo> {
  const [inserted] = await db
    .insert(koJpVideos)
    .values({
      ...data,
      sourceLanguage: "auto",
      targetLanguage: "jp",
      adaptationMode: data.adaptationMode || "drama_elder_assertive",
      status: data.status || "ready",
    })
    .returning();
  return inserted;
}

export async function updateVideoAudio(
  id: number,
  audioUrl: string,
  audioPath?: string,
  audioDuration?: number
): Promise<KoJpVideo> {
  const [updated] = await db
    .update(koJpVideos)
    .set({
      audioUrl,
      audioPath,
      audioDuration,
      updatedAt: new Date(),
    })
    .where(eq(koJpVideos.id, id))
    .returning();
  return updated;
}
