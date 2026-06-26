import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

// Recent jobs
const jobs = await sql`
  SELECT id, video_id, stage, status, retry_count,
    EXTRACT(EPOCH FROM (finished_at - started_at))::int as dur_s,
    consumed_at IS NOT NULL as consumed,
    LEFT(error_message, 80) as err
  FROM jobs ORDER BY id DESC LIMIT 20`;

console.log("=== RECENT JOBS (newest first) ===");
for (const j of jobs) {
  const flag = j.consumed ? "✓" : "·";
  const dur = j.dur_s != null ? `${j.dur_s}s` : "-";
  const err = j.err ? ` | err: ${j.err}` : "";
  console.log(`${flag} #${j.id} video#${j.video_id} [${j.stage}] ${j.status} retry=${j.retry_count} dur=${dur}${err}`);
}

// Videos by status
const vs = await sql`SELECT status, count(*)::int as n FROM videos GROUP BY status ORDER BY status`;
console.log("\n=== VIDEOS ===");
for (const v of vs) console.log(`  ${v.status}: ${v.n}`);

// Running jobs
const running = await sql`
  SELECT id, stage, video_id, EXTRACT(EPOCH FROM (NOW()-started_at))::int as age_s
  FROM jobs WHERE status = 'running'`;
if (running.length) {
  console.log("\n=== RUNNING ===");
  for (const r of running) console.log(`  #${r.id} [${r.stage}] video#${r.video_id} age=${r.age_s}s`);
} else {
  console.log("\n(no running jobs)");
}

// Unconsumed done jobs
const unconsumed = await sql`SELECT id, stage, video_id FROM jobs WHERE status='done' AND consumed_at IS NULL`;
if (unconsumed.length) {
  console.log("\n=== UNCONSUMED DONE ===");
  for (const u of unconsumed) console.log(`  #${u.id} [${u.stage}] video#${u.video_id}`);
} else {
  console.log("(no unconsumed done jobs)");
}

process.exit(0);
