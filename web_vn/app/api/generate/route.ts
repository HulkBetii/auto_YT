import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createStory, updateStoryStatus } from '@/lib/db/repo/stories';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, topicMatrix } = body;

    const slug = (title || 'truyen-sam-ke-chuyen')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '') + '-' + Date.now();

    const story = await createStory({
      title: title || 'Kịch bản Sâm Kể Chuyện',
      slug,
      topicMatrix,
    });

    const pythonScript = path.resolve(process.cwd(), 'scripts', 'chatgpt_vn_story_pipeline.py');
    const outputDir = path.resolve(process.cwd(), 'output', `story_${story.id}`);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(outputDir, 'topic_seed.json'),
      JSON.stringify({ ...topicMatrix, title, story_id: story.id }, null, 2),
      'utf-8'
    );

    const child = spawn('python', [pythonScript, '--story-id', String(story.id)], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return NextResponse.json({
      success: true,
      storyId: story.id,
      slug,
      message: 'Playwright ChatGPT story generation pipeline launched in background.',
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const storyId = searchParams.get('storyId');

    if (!storyId) {
      return NextResponse.json({ success: false, error: 'storyId is required' }, { status: 400 });
    }

    const resolvedFolder = String(storyId).startsWith('story_') 
      ? String(storyId) 
      : (String(storyId) === 'test_01' ? 'story_test_01' : `story_${storyId}`);
    const outputDir = path.resolve(process.cwd(), 'output', resolvedFolder);

    const readFileIfExists = (...fileNames: string[]) => {
      for (const name of fileNames) {
        const p = path.join(outputDir, name);
        if (fs.existsSync(p)) {
          return fs.readFileSync(p, 'utf-8');
        }
      }
      return null;
    };

    const turns = {
      turn1_blueprint: readFileIfExists('turn1_blueprint.md'),
      turn2_chapters_1_3: readFileIfExists('turn2_chapters_1_3.md', 'turn2_chapters_1_4.md'),
      turn3_chapters_4_6: readFileIfExists('turn3_chapters_4_6.md', 'turn3_chapters_5_7.md'),
      turn4_chapters_7_9: readFileIfExists('turn4_chapters_7_9.md', 'turn4_chapters_8_10.md'),
      turn5_chapter_10_outro: readFileIfExists('turn5_chapter_10_outro.md'),
      turn6_metadata_seo: readFileIfExists('turn6_metadata_seo.md', 'turn5_metadata_seo.md'),
      full_script: readFileIfExists('full_story_script.md'),
    };

    let totalWords = 0;
    if (turns.full_script) {
      totalWords = turns.full_script.split(/\s+/).filter(Boolean).length;
    }

    const isCompleted = !!(turns.turn6_metadata_seo && turns.full_script);

    return NextResponse.json({
      success: true,
      storyId,
      turns,
      totalWords,
      isCompleted,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
