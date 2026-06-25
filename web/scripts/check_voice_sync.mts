import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const apiKey = process.env.VIVOO_API_KEY!;

type CloneVoice = {
  voice_id: string;
  id?: string | number;
  name?: string;
  voice_name?: string;
};

type CloneVoiceResponse = CloneVoice[] | {
  data?: CloneVoice[];
  voices?: CloneVoice[];
  list?: CloneVoice[];
};

function normalizeVoiceIdForV3(voiceId: string): string {
  if (/^\d+$/.test(voiceId)) return `clone_${voiceId}`;
  return voiceId;
}

// 1. Get voice map from DB
const [row] = await sql`SELECT value FROM channel_config WHERE key = 'tts_voice_map'`;
const voiceMap: Record<string, string> = JSON.parse(row?.value ?? "{}");
console.log("=== Voice map in DB ===");
for (const [person, voiceId] of Object.entries(voiceMap)) {
  const type = voiceId.startsWith("clone_") ? "clone" : /^\d+$/.test(voiceId) ? "clone_raw" : voiceId.split("_", 1)[0];
  console.log(`  ${person}: ${voiceId} (${type})`);
}

// 2. Get cloned voices from AI33 v3 Voice Library
console.log("\n=== Clone voices on AI33 ===");
const cloneRes = await fetch("https://api.ai33.pro/v3/voices?provider=clone&page_size=100", {
  headers: { "xi-api-key": apiKey }
});
const cloneJson = await cloneRes.json() as CloneVoiceResponse;
const cloneVoices = Array.isArray(cloneJson) ? cloneJson : (cloneJson.data ?? cloneJson.voices ?? cloneJson.list ?? []);
for (const v of cloneVoices) {
  const id = v.voice_id ?? String(v.id ?? "");
  const name = v.name ?? v.voice_name ?? "-";
  console.log(`  ${id} — ${name}`);
}

// 3. Cross-check: each DB voice exists on AI33?
console.log("\n=== Sync check ===");
const ai33Ids = new Set(cloneVoices.map((v) => v.voice_id));
for (const [person, voiceId] of Object.entries(voiceMap)) {
  const normalizedVoiceId = normalizeVoiceIdForV3(voiceId);
  if (!normalizedVoiceId.startsWith("clone_")) {
    console.log(`  - ${person}: ${voiceId} → không kiểm tra trong provider=clone`);
  } else if (ai33Ids.has(normalizedVoiceId)) {
    console.log(`  ✓ ${person}: ${voiceId} → tìm thấy trên AI33 (${normalizedVoiceId})`);
  } else {
    console.log(`  ✗ ${person}: ${voiceId} → KHÔNG tìm thấy trên AI33 (${normalizedVoiceId})!`);
  }
}
process.exit(0);
