import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

// 1. Clear tts_task_id for video #101 so it retries with fresh voice
await sql`UPDATE videos SET tts_task_id = NULL WHERE id = 101`;
console.log("✓ Cleared tts_task_id for video #101");

// 2. Update voice map: add 小林正観 → clone_2572202 (Minimax, since ElevenLabs is broken on AI33)
const [row] = await sql`SELECT value FROM channel_config WHERE key = 'tts_voice_map'`;
const currentMap = JSON.parse(row?.value ?? '{}');
console.log("Current voice map:", currentMap);

// 小林正観 featured_person value — check DB
const [v101] = await sql`SELECT featured_person FROM videos WHERE id = 101`;
console.log("Video #101 featured_person:", v101.featured_person);

// Add mapping: use the exact featured_person value stored in DB
currentMap[v101.featured_person] = "clone_2572202";
const newMap = JSON.stringify(currentMap);
await sql`UPDATE channel_config SET value = ${newMap} WHERE key = 'tts_voice_map'`;
console.log("✓ Updated voice map:", currentMap);

process.exit(0);
