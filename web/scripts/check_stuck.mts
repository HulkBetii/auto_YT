import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const [job] = await sql`
  SELECT id, stage, status, video_id, started_at, finished_at, error_message,
         now() - started_at AS running_for
  FROM jobs WHERE id = 143
`;
const [vid] = await sql`SELECT id, status, title, featured_person FROM videos WHERE id = 49`;
const [running] = await sql`SELECT now()`;

console.log("Time now :", running.now);
console.log("\nJob #143 :", JSON.stringify(job, null, 2));
console.log("\nVideo #49:", JSON.stringify(vid, null, 2));

// Check all running jobs
const runningJobs = await sql`
  SELECT id, stage, video_id, started_at, now() - started_at AS running_for
  FROM jobs WHERE status = 'running'
  ORDER BY started_at
`;
console.log("\nAll running jobs:", JSON.stringify(runningJobs, null, 2));
process.exit(0);
