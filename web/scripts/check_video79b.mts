import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
const rows = await sql`SELECT id, status, title, featured_person FROM videos WHERE id IN (78, 79) ORDER BY id`;
if (rows.length === 0) {
  console.log("Videos #78 and #79 do NOT exist in DB");
} else {
  for (const v of rows) console.log(`Video #${v.id}: [${v.status}] ${v.featured_person} | "${v.title}"`);
}
const jobs = await sql`SELECT id, video_id, stage, status, consumed_at FROM jobs WHERE video_id IN (78, 79) ORDER BY id`;
for (const j of jobs) console.log(`  job#${j.id} video#${j.video_id} [${j.stage}] ${j.status}`);
process.exit(0);
