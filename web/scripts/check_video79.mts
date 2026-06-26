import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const videos = await sql`SELECT id, status, title FROM videos ORDER BY id DESC LIMIT 15`;
console.log("Recent videos:");
for (const v of videos) console.log(`  #${v.id} [${v.status}] "${v.title?.slice(0,50)}"`);

const jobs79 = await sql`
  SELECT j.id, j.video_id, j.stage, j.status, j.retry_count, j.consumed_at, j.error_message
  FROM jobs j WHERE j.video_id IN (SELECT id FROM videos ORDER BY id DESC LIMIT 15)
  ORDER BY j.id DESC LIMIT 20`;
console.log("\nRecent jobs:");
for (const j of jobs79) console.log(`  job#${j.id} video#${j.video_id} [${j.stage}] ${j.status} consumed=${j.consumed_at ? "yes" : "no"}`);
process.exit(0);
