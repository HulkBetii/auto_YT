import { NextResponse } from 'next/server';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import util from 'util';

const execAsync = util.promisify(exec);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const storyId = searchParams.get('storyId') || 'story_bo_chong_drama_04';
    const fileName = searchParams.get('file');

    const resolvedFolder = String(storyId).startsWith('story_')
      ? String(storyId)
      : `story_${storyId}`;

    const outputDir = path.resolve(process.cwd(), 'output', resolvedFolder);

    // 1. Serve image file directly if requested
    if (fileName) {
      const imagePath = path.join(outputDir, fileName);
      if (!fs.existsSync(imagePath)) {
        return NextResponse.json({ success: false, error: 'Image not found' }, { status: 404 });
      }

      const stat = fs.statSync(imagePath);
      const fileStream = fs.createReadStream(imagePath);
      const mimeType = fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';

      return new NextResponse(fileStream as any, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(stat.size),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    }

    // 2. Read state file if present
    const stateFile = path.join(outputDir, 'thumbnail_pipeline_data.json');
    let pipelineData: any = null;
    if (fs.existsSync(stateFile)) {
      try {
        pipelineData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      } catch (err) {
        console.error('Error reading pipeline state:', err);
      }
    }

    // 3. Check for images on disk
    const dramaScenePath = path.join(outputDir, 'drama_scene_raw.png');
    const genImagePath = path.join(outputDir, 'thumbnail_generated.png');
    const rawImagePath = path.join(outputDir, 'thumbnail_raw.png');
    const finalThumbPath = path.join(outputDir, 'thumbnail_youtube.png');

    const hasDramaScene = fs.existsSync(dramaScenePath);
    const hasGeneratedImage = fs.existsSync(genImagePath);
    const hasRawImage = fs.existsSync(rawImagePath);
    const hasFinalThumbnail = fs.existsSync(finalThumbPath);

    const activeImageFile = hasDramaScene
      ? 'drama_scene_raw.png'
      : (hasGeneratedImage ? 'thumbnail_generated.png' : (hasRawImage ? 'thumbnail_raw.png' : null));

    return NextResponse.json({
      success: true,
      storyId,
      hasRawImage: hasDramaScene || hasGeneratedImage || hasRawImage,
      hasFinalThumbnail,
      pipelineData,
      rawImageUrl: activeImageFile ? `/api/thumbnail?storyId=${storyId}&file=${activeImageFile}&t=${Date.now()}` : null,
      finalThumbnailUrl: hasFinalThumbnail ? `/api/thumbnail?storyId=${storyId}&file=thumbnail_youtube.png&t=${Date.now()}` : null,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      storyId = 'story_bo_chong_drama_04',
      action = 'full', // 'full' | 'concepts' | 'hooks' | 'generate_image' | 'qc' | 'composite' | 'repair' | 'select_concept'
      provider = 'playwright_chatgpt',
      title,
      badge = '🎙️ SÂM KỂ CHUYỆN',
      subtitle,
      emotion,
      hostPos,
      conceptId,
      hookId,
      headless = false,
      skipGen = false,
      sync = false,
    } = body;

    const pipelineScript = path.resolve(process.cwd(), 'scripts', 'thumbnail_pipeline', 'pipeline_runner.py');
    const args = [pipelineScript, '--story-id', String(storyId)];

    if (action === 'full') {
      args.push('--stage', 'full');
      if (provider) args.push('--provider', provider);
      if (title) args.push('--title', title);
      if (badge) args.push('--badge', badge);
      if (conceptId) args.push('--concept-id', conceptId);
      if (hookId) args.push('--hook-id', hookId);
      if (emotion) args.push('--emotion', emotion);
      if (hostPos) args.push('--host-pos', hostPos);
      if (headless) args.push('--headless');
      if (skipGen) args.push('--skip-gen');
    } else if (action === 'concepts') {
      args.push('--stage', '3');
    } else if (action === 'hooks') {
      args.push('--stage', '4');
    } else if (action === 'select_concept') {
      args.push('--stage', '6');
      if (conceptId) args.push('--concept-id', conceptId);
      if (hookId) args.push('--hook-id', hookId);
      if (title) args.push('--title', title);
    } else if (action === 'generate_image' || action === 'scene') {
      args.push('--stage', '7a');
      if (provider) args.push('--provider', provider);
      if (headless) args.push('--headless');
    } else if (action === 'qc') {
      args.push('--stage', '8');
    } else if (action === 'repair' || action === 'composite' || action === 'recomposite') {
      args.push('--stage', 'composite');
      if (title) args.push('--title', title);
      if (badge) args.push('--badge', badge);
      if (emotion) args.push('--emotion', emotion);
      if (hostPos) args.push('--host-pos', hostPos);
    }

    if (sync) {
      const cmdStr = `python "${pipelineScript}" ${args.slice(1).map(a => `"${a}"`).join(' ')}`;
      const { stdout, stderr } = await execAsync(cmdStr, { cwd: process.cwd() });
      
      const resolvedFolder = String(storyId).startsWith('story_') ? String(storyId) : `story_${storyId}`;
      const stateFile = path.resolve(process.cwd(), 'output', resolvedFolder, 'thumbnail_pipeline_data.json');
      let pipelineData = null;
      if (fs.existsSync(stateFile)) {
        try {
          pipelineData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        } catch (e) {}
      }

      return NextResponse.json({
        success: true,
        storyId,
        action,
        pipelineData,
        message: `Action ${action} executed successfully.`,
      });
    }

    // Async execution
    const child = spawn('python', args, {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return NextResponse.json({
      success: true,
      storyId,
      action,
      message: `Action '${action}' triggered in background.`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
