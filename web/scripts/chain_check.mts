import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const minId = Number(process.argv[2] ?? 155);
const jobs = await sql`
  SELECT j.id, j.stage, j.status, j.video_id, j.error_message,
         v.featured_person, v.status as vstatus
  FROM jobs j LEFT JOIN videos v ON v.id = j.video_id
  WHERE j.id >= ${minId}
  ORDER BY j.id
`;
console.log(`Jobs >= ${minId}:`);
for (const j of jobs)
  console.log(`  #${j.id} [${j.stage}] ${j.status.padEnd(9)} vid=#${j.video_id}(${j.vstatus}) ${j.featured_person ?? ""} ${j.error_message ?? ""}`);
process.exit(0);
