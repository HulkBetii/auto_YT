/**
 * Check status of a submitted TTS task
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

const taskId = process.argv[2];
if (!taskId) { console.error("Usage: tsx check_tts_task.mts <task_id>"); process.exit(1); }

const apiKey = process.env.VIVOO_API_KEY!;
const res = await fetch(`https://api.ai33.pro/v3/task/${taskId}`, {
  headers: { Authorization: apiKey },
});
console.log("HTTP status:", res.status);
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(0);
