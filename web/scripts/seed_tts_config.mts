/**
 * Seeds TTS voice map and default voice into channel_config.
 * Run once: pnpm tsx scripts/seed_tts_config.mts
 */
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../.env.local") });

// Dynamic import after dotenv so DATABASE_URL is available
const { setConfigValue } = await import("../lib/db/repo/channel-config.js");

const voiceMap = {
  "Tenpu Nakamura": "clone_2572202",
  "Kazuo Inamori": "clone_2574216",
  "Konosuke Matsushita": "clone_1624283",
  "Kakuei Tanaka": "clone_2093524",
  "Miwa Akihiro": "clone_2222532",
};

await setConfigValue("tts_voice_map", JSON.stringify(voiceMap));
console.log("✓ tts_voice_map saved:", JSON.stringify(voiceMap));

await setConfigValue("tts_default_voice", "clone_2572202");
console.log("✓ tts_default_voice saved: clone_2572202");

process.exit(0);
