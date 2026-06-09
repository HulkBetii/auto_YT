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
  // Japanese names (as stored in featured_person column)
  "松下幸之助": "clone_1624283",   // Konosuke Matsushita
  "稲盛和夫":   "clone_2574216",   // Kazuo Inamori
  "美輪明宏":   "clone_2222532",   // Miwa Akihiro
  "田中角栄":   "clone_2093524",   // Kakuei Tanaka
  // English aliases (for future videos if featured_person ever uses English)
  "Konosuke Matsushita": "clone_1624283",
  "Kazuo Inamori":       "clone_2574216",
  "Miwa Akihiro":        "clone_2222532",
  "Kakuei Tanaka":       "clone_2093524",
  "Tenpu Nakamura":      "clone_2572202",
};

await setConfigValue("tts_voice_map", JSON.stringify(voiceMap));
console.log("✓ tts_voice_map updated with Japanese + English keys:");
for (const [k, v] of Object.entries(voiceMap)) {
  console.log(`  ${k} → ${v}`);
}

// Default stays Tenpu Nakamura
await setConfigValue("tts_default_voice", "clone_2572202");
console.log("✓ tts_default_voice: clone_2572202 (Tenpu Nakamura)");

process.exit(0);
