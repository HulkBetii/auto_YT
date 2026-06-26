import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

// Jobs whose video was deleted
const orphanedJobs = await sql`
  SELECT j.id, j.video_id, j.stage, j.status
  FROM jobs j LEFT JOIN videos v ON j.video_id = v.id
  WHERE j.video_id IS NOT NULL AND v.id IS NULL`;
console.log(`Orphaned jobs: ${orphanedJobs.length}`);
for (const o of orphanedJobs) console.log(`  #${o.id} video#${o.video_id} [${o.stage}] ${o.status}`);

// video_content rows whose video was deleted
const orphanedContent = await sql`
  SELECT COUNT(*)::int as n FROM video_content vc
  LEFT JOIN videos v ON vc.video_id = v.id WHERE v.id IS NULL`;
console.log(`Orphaned video_content rows: ${orphanedContent[0].n}`);

// All remaining videos
const vids = await sql`SELECT id, status, featured_person, title FROM videos ORDER BY id`;
console.log(`\nAll videos (${vids.length}):`);
for (const v of vids) {
  console.log(`  #${v.id} [${v.status}] ${v.featured_person} | ${String(v.title).slice(0,45)}`);
}
process.exit(0);
