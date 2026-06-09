import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const JOB_ID = 143;

// Only reset if still running (idempotent)
const [before] = await sql`SELECT id, status, started_at FROM jobs WHERE id = ${JOB_ID}`;
if (!before) { console.error("Job not found"); process.exit(1); }
if (before.status !== "running") {
  console.log(`Job #${JOB_ID} is already "${before.status}", nothing to do.`);
  process.exit(0);
}

await sql`
  UPDATE jobs
  SET status = 'pending', started_at = NULL, error_message = 'reset: stuck running >15min'
  WHERE id = ${JOB_ID} AND status = 'running'
`;

const [after] = await sql`SELECT id, status, started_at FROM jobs WHERE id = ${JOB_ID}`;
console.log(`Job #${JOB_ID}: ${before.status} → ${after.status}`);
console.log("Worker sẽ tự pick up lại trong vòng poll tiếp theo.");
process.exit(0);
