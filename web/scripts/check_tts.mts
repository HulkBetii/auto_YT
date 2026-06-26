import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const videos = await sql`
  SELECT id, title, status, featured_person, score,
    audio_url IS NOT NULL as has_audio, audio_url
  FROM videos WHERE status IN ('ready_to_publish','published')
  ORDER BY id DESC`;
console.log("=== READY/PUBLISHED VIDEOS ===");
for (const v of videos) {
  const audio = v.has_audio ? "🎙✓" : "🔇-";
  console.log(`#${v.id} [${v.status}] ${audio} score=${v.score} | ${v.featured_person} | ${String(v.title).slice(0, 40)}`);
  if (v.audio_url) console.log(`       ${v.audio_url}`);
}
process.exit(0);
