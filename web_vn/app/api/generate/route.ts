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

    const outputDir = path.resolve(process.cwd(), 'output', `story_${storyId}`);
    const turns = {
      turn1_blueprint: fs.existsSync(path.join(outputDir, 'turn1_blueprint.md')) 
        ? fs.readFileSync(path.join(outputDir, 'turn1_blueprint.md'), 'utf-8') : null,
      turn2_chapters_1_4: fs.existsSync(path.join(outputDir, 'turn2_chapters_1_4.md'))
        ? fs.readFileSync(path.join(outputDir, 'turn2_chapters_1_4.md'), 'utf-8') : null,
      turn3_chapters_5_7: fs.existsSync(path.join(outputDir, 'turn3_chapters_5_7.md'))
        ? fs.readFileSync(path.join(outputDir, 'turn3_chapters_5_7.md'), 'utf-8') : null,
      turn4_chapters_8_10: fs.existsSync(path.join(outputDir, 'turn4_chapters_8_10.md'))
        ? fs.readFileSync(path.join(outputDir, 'turn4_chapters_8_10.md'), 'utf-8') : null,
      turn5_metadata_seo: fs.existsSync(path.join(outputDir, 'turn5_metadata_seo.md'))
        ? fs.readFileSync(path.join(outputDir, 'turn5_metadata_seo.md'), 'utf-8') : null,
      full_script: fs.existsSync(path.join(outputDir, 'full_story_script.md'))
        ? fs.readFileSync(path.join(outputDir, 'full_story_script.md'), 'utf-8') : null,
    };

    let totalWords = 0;
    if (turns.full_script) {
      totalWords = turns.full_script.split(/\s+/).filter(Boolean).length;
    }

    return NextResponse.json({
      success: true,
      storyId,
      turns,
      totalWords,
      isCompleted: !!turns.turn5_metadata_seo,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
