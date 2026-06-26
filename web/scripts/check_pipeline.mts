import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

// 1. Jobs by status
const jobCounts = await sql`SELECT status, count(*) FROM jobs GROUP BY status ORDER BY status`;
console.log("\n=== Jobs by status ===");
for (const r of jobCounts) console.log(`  ${r.status}: ${r.count}`);

// 2. Videos by status
const vidCounts = await sql`SELECT status, count(*) FROM videos GROUP BY status ORDER BY status`;
console.log("\n=== Videos by status ===");
for (const r of vidCounts) console.log(`  ${r.status}: ${r.count}`);

// 3. Running/pending jobs detail
const active = await sql`
  SELECT j.id, j.video_id, j.stage, j.status, j.started_at,
         v.title, v.status as video_status
  FROM jobs j LEFT JOIN videos v ON v.id = j.video_id
  WHERE j.status IN ('running', 'pending')
  ORDER BY j.id DESC LIMIT 20`;
console.log("\n=== Active jobs (running/pending) ===");
if (active.length === 0) console.log("  (none)");
for (const r of active) {
  const age = r.started_at ? Math.round((Date.now() - new Date(r.started_at).getTime()) / 60000) + "m ago" : "not started";
  console.log(`  job#${r.id} video#${r.video_id} [${r.stage}] ${r.status} started=${age} | "${r.title?.slice(0,40)}"`);
}

// 4. Recently failed jobs
const failed = await sql`
  SELECT j.id, j.video_id, j.stage, j.status, j.retry_count, j.error_message, j.finished_at,
         v.title
  FROM jobs j LEFT JOIN videos v ON v.id = j.video_id
  WHERE j.status = 'failed'
  ORDER BY j.finished_at DESC NULLS LAST LIMIT 10`;
console.log("\n=== Recent failed jobs ===");
if (failed.length === 0) console.log("  (none)");
for (const r of failed) console.log(`  job#${r.id} video#${r.video_id} [${r.stage}] retry=${r.retry_count} err="${String(r.error_message ?? "").slice(0,80)}" | "${String(r.title ?? "").slice(0,40)}"`);

// 5. Stale running jobs (started > 15min ago, still running)
const stale = await sql`
  SELECT j.id, j.video_id, j.stage, j.started_at,
         extract(epoch from (now() - j.started_at))/60 as minutes_running
  FROM jobs j
  WHERE j.status = 'running'
    AND j.started_at < now() - interval '15 minutes'
    AND j.started_at IS NOT NULL`;
console.log("\n=== Stale running jobs (>15min) ===");
if (stale.length === 0) console.log("  (none)");
for (const r of stale) console.log(`  job#${r.id} video#${r.video_id} [${r.stage}] running ${Math.round(Number(r.minutes_running))}min`);

// 6. Done-but-not-chained (consumed_at IS NULL)
const unconsumed = await sql`
  SELECT j.id, j.video_id, j.stage, j.finished_at
  FROM jobs j
  WHERE j.status = 'done' AND j.consumed_at IS NULL
  ORDER BY j.id DESC LIMIT 10`;
console.log("\n=== Done-but-not-chained jobs (consumed_at NULL) ===");
if (unconsumed.length === 0) console.log("  (none)");
for (const r of unconsumed) console.log(`  job#${r.id} video#${r.video_id} [${r.stage}] finished=${r.finished_at}`);

process.exit(0);
