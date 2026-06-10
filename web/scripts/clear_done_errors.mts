import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

// Clear stale error_message on done jobs — they succeeded (after retry),
// so showing the intermediate error is misleading.
const result = await sql`
  UPDATE jobs SET error_message = NULL
  WHERE status = 'done' AND error_message IS NOT NULL
  RETURNING id, stage, video_id
`;
console.log(`Cleared error_message on ${result.length} done jobs:`);
for (const r of result) console.log(`  job#${r.id} [${r.stage}] video#${r.video_id}`);
process.exit(0);
