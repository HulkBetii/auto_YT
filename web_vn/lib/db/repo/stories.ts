import { db } from '../index';
import { stories, chapters, jobs, type stories as StoryType } from '../schema';
import { eq, desc } from 'drizzle-orm';

export async function getAllStories() {
  return await db.select().from(stories).orderBy(desc(stories.createdAt));
}

export async function getStoryById(id: number) {
  const [story] = await db.select().from(stories).where(eq(stories.id, id));
  if (!story) return null;
  const storyChapters = await db.select().from(chapters).where(eq(chapters.storyId, id)).orderBy(chapters.chapterNumber);
  return { ...story, chapters: storyChapters };
}

export async function createStory(data: {
  title: string;
  slug: string;
  targetDurationMinutes?: number;
  topicMatrix?: any;
  masterBlueprint?: any;
}) {
  const [created] = await db.insert(stories).values({
    title: data.title,
    slug: data.slug,
    targetDurationMinutes: data.targetDurationMinutes || 150,
    topicMatrix: data.topicMatrix,
    masterBlueprint: data.masterBlueprint,
    status: 'draft',
  }).returning();
  return created;
}

export async function updateStoryStatus(id: number, status: string, extra?: Partial<typeof stories.$inferInsert>) {
  const [updated] = await db.update(stories)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(stories.id, id))
    .returning();
  return updated;
}
