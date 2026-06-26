import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
const videoId = Number(process.argv[2] ?? 77);
const [r] = await sql`SELECT output FROM video_content WHERE video_id = ${videoId} AND stage = 'P4' ORDER BY id DESC LIMIT 1`;
if (!r) { console.log(`No P4 for video #${videoId}`); process.exit(1); }
console.log(r.output);
process.exit(0);
