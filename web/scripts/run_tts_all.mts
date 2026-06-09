/**
 * Runs TTS for ALL ready_to_publish videos without audio_url.
 * Processes them one at a time and prints progress.
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

const { db } = await import("../lib/db/index.js");
const { videos } = await import("../lib/db/schema/index.js");
const { eq } = await import("drizzle-orm");
const { getLatestVideoContent } = await import("../lib/db/repo/video-content.js");
const { updateVideoAudioUrl } = await import("../lib/db/repo/videos.js");
const { parseP3ForTTS, getVoiceId, submitTTS, pollTTSTask } = await import("../lib/pipeline/tts.js");

const all = await db.select().from(videos).where(eq(videos.status, "ready_to_publish")).orderBy(videos.id as never);
const toProcess = all.filter((v) => !v.audioUrl);

console.log(`\n📋 ${toProcess.length} videos to process (${all.length - toProcess.length} already have audio)\n`);

let succeeded = 0;
let failed = 0;

for (const video of toProcess) {
  const tag = `#${video.id} ${video.featuredPerson}`;
  try {
    const p3 = await getLatestVideoContent(video.id, "P3");
    if (!p3) { console.log(`⚠️  ${tag} — no P3 content, skipping`); failed++; continue; }

    const text = parseP3ForTTS(p3.output);
    if (!text) { console.log(`⚠️  ${tag} — P3 parsed to empty, skipping`); failed++; continue; }

    const voiceId = await getVoiceId(video.featuredPerson);
    console.log(`🎙️  ${tag} → voice=${voiceId} (${text.length} chars)`);

    const taskId = await submitTTS(text, voiceId);
    console.log(`   submitted task=${taskId}, polling...`);

    const audioUrl = await pollTTSTask(taskId, 600_000); // 10 min max per video (clone voice can be slow)
    await updateVideoAudioUrl(video.id, audioUrl);

    console.log(`   ✓ ${audioUrl}`);
    succeeded++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`   ✗ ${tag}: ${msg}`);
    failed++;
  }
}

console.log(`\n✅ Done: ${succeeded} audio generated, ${failed} failed`);
process.exit(0);
