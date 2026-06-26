import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const jobs = await sql`
  SELECT id, stage, status, video_id, error_message, created_at, finished_at
  FROM jobs WHERE id >= 406 ORDER BY id ASC`;

console.log("=== Jobs từ batch mới ===");
for (const j of jobs) {
  const dur = j.finished_at && j.created_at
    ? Math.round((new Date(j.finished_at).getTime() - new Date(j.created_at).getTime()) / 1000) + 's'
    : '-';
  const err = j.error_message ? ' ❌ ' + j.error_message.slice(0, 60) : '';
  console.log(`  #${j.id} [${j.status}] ${j.stage} video=${j.video_id ?? '-'} dur=${dur}${err}`);
}

const vids = await sql`
  SELECT id, featured_person, status, score, audio_url IS NOT NULL as has_audio
  FROM videos WHERE id > 96 ORDER BY id`;
console.log("\n=== Videos mới (id > 96) ===");
if (vids.length === 0) console.log("  (chưa có)");
for (const v of vids) console.log(`  #${v.id} [${v.status}] ${v.featured_person} score=${v.score ?? '-'} audio=${v.has_audio}`);
process.exit(0);
