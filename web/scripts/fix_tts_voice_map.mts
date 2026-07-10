/**
 * Updates tts_voice_map to use Japanese names (as stored in featured_person column)
 * and also keeps English aliases for future videos.
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

const { setConfigValue } = await import("../lib/db/repo/channel-config.js");

const voiceMap: Record<string, string> = {
  "美輪明宏": "clone_2222532",
  "Miwa Akihiro": "clone_2222532",
};

await setConfigValue("tts_voice_map", JSON.stringify(voiceMap));
console.log("✓ tts_voice_map updated with Japanese + English keys:");
for (const [k, v] of Object.entries(voiceMap)) {
  console.log(`  ${k} → ${v}`);
}

await setConfigValue("tts_default_voice", "clone_2222532");
console.log("✓ tts_default_voice: clone_2222532 (Miwa Akihiro)");

process.exit(0);
