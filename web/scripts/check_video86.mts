import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const [v] = await sql`SELECT id, status, title, featured_person, score, retry_count FROM videos WHERE id = 86`;
if (!v) { console.log("Video #86 not found"); process.exit(1); }
console.log(`#${v.id} [${v.status}] score=${v.score} retry=${v.retry_count} | ${v.featured_person} | ${v.title}`);

const jobs = await sql`
  SELECT id, stage, status, retry_count,
    EXTRACT(EPOCH FROM (finished_at - started_at))::int as dur_s,
    LEFT(error_message, 100) as err
  FROM jobs WHERE video_id = 86 ORDER BY id`;
console.log("\nJobs:");
for (const j of jobs) {
  console.log(`  #${j.id} [${j.stage}] ${j.status} retry=${j.retry_count} dur=${j.dur_s}s${j.err ? " ERR:" + j.err : ""}`);
}

const p3 = await sql`SELECT id, LENGTH(output) as len FROM video_content WHERE video_id = 86 AND stage = 'P3' ORDER BY id DESC LIMIT 3`;
console.log("\nP3 versions:");
for (const p of p3) console.log(`  vc#${p.id}: ${p.len} chars`);

process.exit(0);
