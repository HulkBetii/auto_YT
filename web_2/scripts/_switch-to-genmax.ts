import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const env = readFileSync(".env.local", "utf-8");
const dbUrl = env
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  ?.replace("DATABASE_URL=", "")
  .replace(/^["']|["']$/g, "")
  .trim();

const GENMAX_BASE_URL = "https://api.genmax.io";
const GENMAX_API_KEY = process.env.GENMAX_API_KEY;

const VIDEO_ID = 10;

function isMinimaxVoiceId(voiceId: string): boolean {
  return /^\d+$/.test(voiceId);
}

async function main() {
  if (!dbUrl) throw new Error("DATABASE_URL not set");
  if (!GENMAX_API_KEY) throw new Error("GENMAX_API_KEY not set");

  const sql = neon(dbUrl!);

  // Get video + voice config
  const [video] = await sql`SELECT id, script, audio_url, voice_id FROM ah_videos WHERE id = ${VIDEO_ID}`;
  const [voiceRow] = await sql`SELECT value FROM ah_channel_config WHERE key = 'voice_id_gx'`;
  const [fallbackRow] = await sql`SELECT value FROM ah_channel_config WHERE key = 'voice_id'`;

  const voiceId = voiceRow?.value || fallbackRow?.value;
  if (!voiceId) throw new Error("No voice_id_gx or voice_id configured");
  if (!video?.script) throw new Error(`Video #${VIDEO_ID} has no script`);

  console.log(`Video #${VIDEO_ID} audioUrl: ${video.audio_url}`);
  console.log(`Script length: ${video.script.length} chars`);
  console.log(`Using Genmax voice: ${voiceId}`);

  const minimax = isMinimaxVoiceId(voiceId);
  const body: Record<string, unknown> = {
    text: video.script,
    model_id: minimax ? "speech-2.8-turbo" : "eleven_multilingual_v2",
    language_code: minimax ? "English" : "en",
    ...(minimax && { provider: "minimax" }),
  };

  console.log("Submitting to Genmax...");
  const res = await fetch(
    `${GENMAX_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": GENMAX_API_KEY },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Genmax submit HTTP ${res.status}: ${txt}`);
  }

  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error(`No id in Genmax response: ${JSON.stringify(json)}`);

  const taskId = json.id;
  const newAudioUrl = `tts_task_gx:${taskId}`;
  console.log(`Genmax task ID: ${taskId}`);

  // Update DB
  await sql`UPDATE ah_videos SET audio_url = ${newAudioUrl}, updated_at = NOW() WHERE id = ${VIDEO_ID}`;
  console.log(`✅ Updated video #${VIDEO_ID} audioUrl → ${newAudioUrl}`);
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
