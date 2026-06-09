import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const now = new Date();
console.log("Now:", now.toISOString());

const jobs = await sql`
  SELECT id, stage, status, video_id, started_at, finished_at, error_message,
         EXTRACT(EPOCH FROM (NOW() - started_at))/60 AS running_min
  FROM jobs
  WHERE id IN (166, 167, 168)
`;
for (const j of jobs) {
  console.log(`\nJob #${j.id} [${j.stage}] ${j.status}`);
  console.log(`  started_at: ${j.started_at}`);
  console.log(`  running: ${Number(j.running_min).toFixed(1)} min`);
  console.log(`  error: ${j.error_message ?? "none"}`);
}

// Also check if there are any newer P2 jobs for those videos (in case of restart)
const newer = await sql`
  SELECT id, stage, status, video_id, started_at, error_message
  FROM jobs
  WHERE video_id IN (56, 57, 58) AND id > 168
  ORDER BY id
`;
if (newer.length > 0) {
  console.log("\nNewer jobs for videos 56-58:");
  for (const j of newer) console.log(`  #${j.id} [${j.stage}] ${j.status} vid=${j.video_id} ${j.error_message ?? ""}`);
}
process.exit(0);
