/**
 * Clears audio_url for specified video IDs so TTS re-generates them.
 * Usage: tsx scripts/reset_audio_url.mts 50 54
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const ids = process.argv.slice(2).map(Number).filter(Boolean);
if (ids.length === 0) { console.error("Usage: tsx reset_audio_url.mts <id1> [id2] ..."); process.exit(1); }

console.log(`Resetting audio_url for video(s): ${ids.join(", ")}`);
for (const id of ids) {
  const rows = await sql`UPDATE videos SET audio_url = NULL WHERE id = ${id} RETURNING id, featured_person, title`;
  if (rows.length) console.log(`  ✓ #${rows[0].id} ${rows[0].featured_person} — ${rows[0].title?.slice(0, 50)}`);
  else console.log(`  ✗ #${id} not found`);
}
process.exit(0);
