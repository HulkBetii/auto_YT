import { NextResponse } from 'next/server';
import { getAllStories, createStory } from '@/lib/db/repo/stories';
import { db } from '@/lib/db';
import { chapters } from '@/lib/db/schema';

export async function GET() {
  try {
    const list = await getAllStories();
    return NextResponse.json({ success: true, stories: list });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, topicMatrix, masterBlueprint, chaptersOutline } = body;
    
    const slug = (title || 'truyen-sam-ke-chuyen')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '') + '-' + Date.now();

    const newStory = await createStory({
      title,
      slug,
      topicMatrix,
      masterBlueprint,
    });

    // If chapter outline provided, insert initial chapters
    if (chaptersOutline && Array.isArray(chaptersOutline)) {
      for (const ch of chaptersOutline) {
        await db.insert(chapters).values({
          storyId: newStory.id,
          chapterNumber: ch.number,
          actName: ch.act,
          title: ch.title,
          goal: ch.goal,
          status: 'pending',
        });
      }
    }

    return NextResponse.json({ success: true, story: newStory });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
