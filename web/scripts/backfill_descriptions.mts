/**
 * Backfills P_desc for all ready_to_publish videos that don't have one yet.
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

// Find ready_to_publish videos without a P_desc row
const rows = await sql`
  SELECT v.id, v.title, v.featured_person
  FROM videos v
  WHERE v.status IN ('ready_to_publish', 'published', 'analyzed')
    AND NOT EXISTS (
      SELECT 1 FROM video_content vc WHERE vc.video_id = v.id AND vc.stage = 'P_desc'
    )
  ORDER BY v.id
`;

if (rows.length === 0) { console.log("All videos already have P_desc."); process.exit(0); }
console.log(`Found ${rows.length} video(s) to backfill:`);
for (const v of rows) console.log(`  #${v.id} ${v.featured_person} — ${v.title?.slice(0, 50)}`);

const { generateAndSaveDescription } = await import("../lib/pipeline/descriptionBuilder.js");

for (const v of rows) {
  try {
    await generateAndSaveDescription(Number(v.id));
    console.log(`  ✓ #${v.id}`);
  } catch (err) {
    console.error(`  ✗ #${v.id}: ${err}`);
  }
}
console.log("\nDone.");
process.exit(0);
