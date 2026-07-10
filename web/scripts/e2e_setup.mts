import { config } from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
config({ path: envPath });

const apiKey = process.env.E2E_VIVOO_API_KEY;
const voiceId = process.env.E2E_VOICE_ID;
if (!apiKey) throw new Error("Missing E2E_VIVOO_API_KEY");
if (!voiceId) throw new Error("Missing E2E_VOICE_ID");

function upsertEnvLine(source: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=`, "m").test(source)) {
    return source.replace(new RegExp(`^${key}=.*$`, "m"), line);
  }
  return `${source.trimEnd()}\n${line}\n`;
}

const currentEnv = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
writeFileSync(envPath, upsertEnvLine(currentEnv, "VIVOO_API_KEY", apiKey), "utf8");

const { setConfigValue } = await import("../lib/db/repo/channel-config.js");

const voiceMap = {
  "美輪明宏": voiceId,
  "Miwa Akihiro": voiceId,
};

await setConfigValue("channel_name", "哲人の刻");
await setConfigValue("score_threshold", "80");
await setConfigValue("max_content_retries", "2");
await setConfigValue("rollback_min_views", "100");
await setConfigValue("p1_topics_per_batch", "1");
await setConfigValue("p6_batch_size", "10");
await setConfigValue("new_batch_paused", "false");
await setConfigValue("tts_default_voice", voiceId);
await setConfigValue("tts_voice_map", JSON.stringify(voiceMap));

console.log("E2E config saved: VIVOO_API_KEY present, voice map updated, p1_topics_per_batch=1");
process.exit(0);
