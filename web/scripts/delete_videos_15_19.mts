import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const IDS = [15, 16, 17, 19];
console.log(`Deleting videos: ${IDS.join(", ")}`);

const analytics = await sql`DELETE FROM video_analytics WHERE video_id = ANY(${IDS}::int[]) RETURNING id`;
const content   = await sql`DELETE FROM video_content   WHERE video_id = ANY(${IDS}::int[]) RETURNING id`;
const jobRows   = await sql`DELETE FROM jobs            WHERE video_id = ANY(${IDS}::int[]) RETURNING id`;
const videoRows = await sql`DELETE FROM videos          WHERE id       = ANY(${IDS}::int[]) RETURNING id, title, featured_person`;

console.log(`  analytics:     ${analytics.length} rows`);
console.log(`  video_content: ${content.length} rows`);
console.log(`  jobs:          ${jobRows.length} rows`);
console.log(`  videos:`);
for (const v of videoRows) console.log(`    #${v.id} ${v.featured_person} — ${v.title}`);
process.exit(0);
