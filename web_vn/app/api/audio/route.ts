import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const storyId = searchParams.get('storyId') || 'test_01';
    const fileName = searchParams.get('file');

    const webVnDir = process.cwd();

    // Serve audio file directly
    if (fileName) {
      let audioPath: string;
      if (fileName.startsWith('test_voices/')) {
        audioPath = path.join(webVnDir, 'output', fileName);
      } else if (fileName.startsWith('samples/')) {
        audioPath = path.join(webVnDir, 'data', 'voice_profiles', fileName);
      } else if (fs.existsSync(path.join(webVnDir, 'data', 'voice_profiles', 'samples', fileName))) {
        audioPath = path.join(webVnDir, 'data', 'voice_profiles', 'samples', fileName);
      } else if (fs.existsSync(path.join(webVnDir, 'output', 'test_voices', fileName))) {
        audioPath = path.join(webVnDir, 'output', 'test_voices', fileName);
      } else {
        const resolvedFolder = String(storyId).startsWith('story_')
          ? String(storyId)
          : (String(storyId) === 'test_01' ? 'story_test_01' : `story_${storyId}`);
        audioPath = path.join(webVnDir, 'output', resolvedFolder, fileName);
      }

      if (!fs.existsSync(audioPath)) {
        return NextResponse.json({ success: false, error: 'Audio file not found' }, { status: 404 });
      }

      const stat = fs.statSync(audioPath);
      const fileStream = fs.createReadStream(audioPath);
      const mimeType = audioPath.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';

      return new NextResponse(fileStream as any, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
        },
      });
    }

    // Return audio generation status
    const resolvedFolder = String(storyId).startsWith('story_')
      ? String(storyId)
      : (String(storyId) === 'test_01' ? 'story_test_01' : `story_${storyId}`);
    const outputDir = path.join(webVnDir, 'output', resolvedFolder);
    const audioDir = path.join(outputDir, 'norm_audio');
    const rawAudioDir = path.join(outputDir, 'audio');
    const manifestPath = path.join(outputDir, 'audio_manifest.jsonl');
    const fullAudioPath = path.join(outputDir, 'full_story_audio.mp3');
    const previewAudioPath = path.join(webVnDir, 'output', 'test_voices', 'vieneu_demo_scene_5_voices.mp3');

    let totalChunks = 0;
    let generatedChunks = 0;

    if (fs.existsSync(manifestPath)) {
      const manifestLines = fs.readFileSync(manifestPath, 'utf-8').split('\n').filter(Boolean);
      totalChunks = manifestLines.length;
    }

    const checkDir = fs.existsSync(audioDir) ? audioDir : (fs.existsSync(rawAudioDir) ? rawAudioDir : null);
    if (checkDir) {
      const wavFiles = fs.readdirSync(checkDir).filter(f => f.endsWith('.wav') && f.startsWith('chunk_'));
      generatedChunks = wavFiles.length;
    }

    const voiceProfilesPath = path.join(webVnDir, 'data', 'voice_profiles', 'voices.json');
    let voiceProfiles = {};
    if (fs.existsSync(voiceProfilesPath)) {
      voiceProfiles = JSON.parse(fs.readFileSync(voiceProfilesPath, 'utf-8'));
    }

    return NextResponse.json({
      success: true,
      storyId,
      totalChunks,
      generatedChunks,
      hasFullAudio: fs.existsSync(fullAudioPath),
      hasPreviewAudio: fs.existsSync(previewAudioPath),
      voiceProfiles,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { storyId = 'test_01', engine = 'vieneu', chapter, limit } = body;

    const pythonScript = path.resolve(process.cwd(), 'scripts', 'story_audio_generator.py');
    const args = [pythonScript, '--story-id', String(storyId), '--engine', String(engine)];
    if (chapter) args.push('--chapter', String(chapter));
    if (limit) args.push('--limit', String(limit));

    const child = spawn('python', args, {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return NextResponse.json({
      success: true,
      storyId,
      engine,
      message: `Story audio generation (${engine.toUpperCase()} 48kHz) launched in background.`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
