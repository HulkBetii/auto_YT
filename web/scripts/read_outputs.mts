import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const videoId = Number(process.argv[2] ?? 45);
const rows = await sql`
  SELECT stage, output FROM video_content
  WHERE video_id = ${videoId} AND stage IN ('P2','P3','P4')
  ORDER BY stage
`;
for (const r of rows) {
  console.log(`\n${"=".repeat(60)}\n${r.stage}\n${"=".repeat(60)}`);
  console.log(r.output);
}
process.exit(0);
