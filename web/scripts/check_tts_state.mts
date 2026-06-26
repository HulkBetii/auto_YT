import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

type Ai33Task = {
  id?: string;
  task_id?: string;
  status?: string;
  frozen_credits?: number | string;
  credit?: number | string;
  created_at?: string;
};

type Ai33TasksResponse = Ai33Task[] | {
  data?: Ai33Task[];
  tasks?: Ai33Task[];
  list?: Ai33Task[];
};

const videos = await sql`
  SELECT id, status, audio_url, tts_task_id, featured_person
  FROM videos WHERE audio_url IS NULL ORDER BY id`;

console.log("Videos without audio:");
for (const v of videos) {
  console.log(`  #${v.id} [${v.status}] ${v.featured_person} tts_task_id=${v.tts_task_id ?? '(null)'}`);
}

// Query AI33 tasks
const apiKey = process.env.VIVOO_API_KEY;
const res = await fetch('https://api.ai33.pro/v1/tasks?type=tts', {
  headers: { 'xi-api-key': apiKey! }
});
const json = await res.json() as Ai33TasksResponse;
const tasks = Array.isArray(json) ? json : (json.data ?? json.tasks ?? json.list ?? []);
console.log(`\nAI33 TTS tasks (${tasks.length}):`);
for (const t of tasks.slice(0, 20)) {
  const id = t.id ?? t.task_id;
  const frozen = t.frozen_credits ?? t.credit ?? '-';
  console.log(`  ${id} [${t.status}] frozen=${frozen} created=${t.created_at ?? ''}`);
}
process.exit(0);
