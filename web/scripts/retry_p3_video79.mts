import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const VIDEO_ID = 79;

// 1. Current state
const [video] = await sql`SELECT id, status, title FROM videos WHERE id = ${VIDEO_ID}`;
console.log(`Video #${VIDEO_ID}: status=${video.status} | "${video.title}"`);

const jobRows = await sql`
  SELECT id, stage, status, retry_count, error_message, created_at, started_at, finished_at, consumed_at
  FROM jobs WHERE video_id = ${VIDEO_ID} ORDER BY id`;
console.log(`\nJobs (${jobRows.length}):`);
for (const j of jobRows) {
  console.log(`  job#${j.id} [${j.stage}] ${j.status} retry=${j.retry_count} consumed=${j.consumed_at ? "yes" : "no"} | err=${j.error_message ?? "—"}`);
}

// 2. Find active P3/P4 jobs that need to be cancelled
const activeJobs = jobRows.filter(j => j.status === "running" || j.status === "pending");
if (activeJobs.length > 0) {
  console.log(`\n⚠️  Active jobs still running:`);
  for (const j of activeJobs) console.log(`  job#${j.id} [${j.stage}] ${j.status}`);
  console.log("  → Cancel these first before retrying P3");
  process.exit(1);
}

// 3. Get active P3 v9 prompt
const [p3prompt] = await sql`SELECT id, version, template FROM prompt_versions WHERE prompt_key = 'P3' AND is_active = true LIMIT 1`;
console.log(`\nUsing P3 v${p3prompt.version} (id=${p3prompt.id})`);

// Get P2 output to interpolate into P3 prompt
const [p2content] = await sql`
  SELECT vc.output FROM video_content vc
  WHERE vc.video_id = ${VIDEO_ID} AND vc.stage = 'P2'
  ORDER BY vc.id DESC LIMIT 1`;
if (!p2content) { console.error("No P2 content found for video #79"); process.exit(1); }

// Get video details for placeholder interpolation
const [vidDetail] = await sql`
  SELECT v.featured_person, v.pain_type, v.temperature,
         vc_p1.output as p1_output
  FROM videos v
  LEFT JOIN video_content vc_p1 ON vc_p1.video_id = v.id AND vc_p1.stage = 'P1'
  WHERE v.id = ${VIDEO_ID}
  ORDER BY vc_p1.id DESC LIMIT 1`;

console.log(`\nP2 output length: ${p2content.output.length} chars`);
console.log(`Person: ${vidDetail.featured_person}, Pain: ${vidDetail.pain_type}, Temp: ${vidDetail.temperature}`);

// 4. Reset video to 'outline' (after P2, before P3) and cancel downstream jobs
await sql`UPDATE videos SET status = 'outline' WHERE id = ${VIDEO_ID}`;
console.log(`\n✓ Video #${VIDEO_ID} reset to 'outline'`);

// Mark P3/P4/P_score done jobs as consumed (so chain skips them) — or delete them
// Actually: we need to mark old P3 job as consumed so it won't be re-processed
// The new P3 job will be created by the chain cycle when it sees video in 'outline'
// But the old P3 job is already consumed. We need to create a NEW P3 job directly.

// Get the interpolated prompt template
// The chain.ts does the interpolation; we need to replicate it here.
// Looking at how P3 is built: [DANYI] = P2 output, [TEMP] = temperature, etc.
// Check chain.ts for the exact interpolation
console.log("\nℹ️  Video reset to 'outline'. Now press 'Chạy pipeline' on dashboard");
console.log("   or run the process-now API to trigger chain cycle and create new P3 job.");
process.exit(0);
