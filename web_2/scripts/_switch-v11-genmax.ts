import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
const env = readFileSync(".env.local", "utf-8");
const get = (key: string) => env.split("\n").find(l => l.startsWith(key + "="))?.replace(key + "=", "").replace(/^["']|["']$/g, "").trim();
const dbUrl = get("DATABASE_URL")!;
const genmaxKey = get("GENMAX_API_KEY")!;
const sql = neon(dbUrl);

const GENMAX_BASE = "https://api.genmax.io";
const VOICE_ID = "VU16byTywsWv5JpI8rbc";

(async () => {
  const [v] = await sql`SELECT script FROM ah_videos WHERE id = 11`;
  const script = v.script as string;
  console.log(`Script length: ${script.length} chars`);

  const res = await fetch(
    `${GENMAX_BASE}/v1/text-to-speech/${encodeURIComponent(VOICE_ID)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": genmaxKey },
      body: JSON.stringify({
        text: script,
        model_id: "eleven_multilingual_v2",
        language_code: "en",
      }),
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Genmax submit HTTP ${res.status}: ${txt}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error(`No task id: ${JSON.stringify(json)}`);
  console.log("Genmax task ID:", json.id);

  const audioUrl = `tts_task_gx:${json.id}`;
  await sql`UPDATE ah_videos SET audio_url = ${audioUrl}, updated_at = NOW() WHERE id = 11 RETURNING id, status, audio_url`;
  console.log("DB updated → audio_url =", audioUrl);
  console.log("Done. Cron sẽ poll Genmax và chạy Whisper khi xong.");
})().catch(console.error);
