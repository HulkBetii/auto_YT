/**
 * Saves already-completed TTS audio_urls for videos whose tasks finished
 * but whose polling timed out before we could capture the URL.
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

const { updateVideoAudioUrl } = await import("../lib/db/repo/videos.js");

// Known completed tasks — collected from check_tts_task.mts runs
const recovered: { videoId: number; taskId: string; audioUrl: string }[] = [
  {
    videoId: 15,
    taskId: "d40c1fe5-7bae-48a5-9a9e-454e1e86186b",
    audioUrl: "https://cdn.ai33.pro/v3/tts/d40c1fe5-7bae-48a5-9a9e-454e1e86186b_1780973184184.mp3",
  },
  {
    videoId: 16,
    taskId: "54ea8ca8-e14b-47a3-9957-fd70785ddb1b",
    audioUrl: "https://cdn.ai33.pro/v3/tts/54ea8ca8-e14b-47a3-9957-fd70785ddb1b_1780973372771.mp3",
  },
  {
    videoId: 17,
    taskId: "56aaafc6-510a-44ca-b687-9bb7169c1d4f",
    audioUrl: "https://cdn.ai33.pro/v3/tts/56aaafc6-510a-44ca-b687-9bb7169c1d4f_1780973559138.mp3",
  },
];

for (const r of recovered) {
  await updateVideoAudioUrl(r.videoId, r.audioUrl);
  console.log(`✓ Video #${r.videoId}: ${r.audioUrl}`);
}
console.log("\nDone.");
process.exit(0);
