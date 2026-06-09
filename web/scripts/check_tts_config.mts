import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

// 1. TTS config values
const configs = await sql`
  SELECT key, value FROM channel_config
  WHERE key IN ('tts_voice_map', 'tts_default_voice', 'contact_email')
`;
console.log("=== Channel Config ===");
for (const c of configs) console.log(`${c.key}: ${c.value}`);

// 2. Ready to publish videos and their audio_url
const videos = await sql`
  SELECT id, featured_person, title, audio_url
  FROM videos
  WHERE status = 'ready_to_publish'
  ORDER BY id
`;
console.log("\n=== ready_to_publish videos ===");
for (const v of videos)
  console.log(`#${v.id} [audio=${v.audio_url ? '✓' : 'NULL'}] ${v.featured_person} — ${v.title?.slice(0,50)}`);

// 3. Check VIVOO_API_KEY
console.log(`\nVIVOO_API_KEY set: ${!!process.env.VIVOO_API_KEY}`);
process.exit(0);
