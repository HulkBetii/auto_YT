import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

// Check job#276 age
const [j276] = await sql`SELECT id, video_id, stage, status, created_at, started_at FROM jobs WHERE id = 276`;
if (j276) {
  const ageMin = Math.round((Date.now() - new Date(j276.created_at).getTime()) / 60000);
  console.log(`\njob#276: [${j276.stage}] ${j276.status} video_id=${j276.video_id} created ${ageMin}min ago`);
}

// ready_to_publish videos — do they have audio_url?
const rtpVideos = await sql`
  SELECT id, title, featured_person, audio_url, created_at
  FROM videos WHERE status = 'ready_to_publish'
  ORDER BY id`;
console.log(`\n=== ready_to_publish videos (${rtpVideos.length}) ===`);
for (const v of rtpVideos) {
  const hasAudio = v.audio_url ? "✓ audio" : "✗ no audio";
  console.log(`  video#${v.id} [${hasAudio}] ${v.featured_person} | "${String(v.title ?? "").slice(0,50)}"`);
}

// Check if there's a voice mapping for these persons
const mapRow = await sql`SELECT value FROM channel_config WHERE key = 'tts_voice_map' LIMIT 1`;
const voiceMap = mapRow[0]?.value ? JSON.parse(mapRow[0].value) : {};
console.log("\n=== Voice map ===");
console.log(JSON.stringify(voiceMap, null, 2));

const persons = [...new Set(rtpVideos.filter(v => !v.audio_url).map(v => v.featured_person))];
console.log("\n=== TTS voice lookup for no-audio videos ===");
for (const p of persons) {
  const needle = (p ?? "").toLowerCase();
  const match = Object.keys(voiceMap).find(k => k.toLowerCase() === needle || k.toLowerCase().includes(needle) || needle.includes(k.toLowerCase()));
  console.log(`  "${p}" → ${match ? `✓ ${voiceMap[match]}` : "✗ NO MAPPING"}`);
}

process.exit(0);
