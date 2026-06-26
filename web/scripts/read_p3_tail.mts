import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
const videoId = Number(process.argv[2] ?? 77);
const [r] = await sql`SELECT output FROM video_content WHERE video_id = ${videoId} AND stage = 'P3' ORDER BY id DESC LIMIT 1`;
if (!r) { console.log(`No P3 for video #${videoId}`); process.exit(1); }
// Print last 400 chars to see the ending
console.log("=== LAST 400 CHARS ===");
console.log(r.output.slice(-400));
console.log("\n=== ALL QUESTION LINES ===");
for (const line of r.output.split("\n")) {
  if (line.includes("？") || line.includes("?")) console.log(JSON.stringify(line));
}
process.exit(0);
