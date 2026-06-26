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
  SELECT output FROM video_content
  WHERE video_id = ${videoId} AND stage = 'P_desc'
  ORDER BY created_at DESC LIMIT 1
`;
if (!rows[0]) { console.log("No P_desc found for video #" + videoId); process.exit(1); }
console.log(rows[0].output);
process.exit(0);
