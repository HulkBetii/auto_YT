/**
 * Fix video #5 audio_url: submit AI33 TTS for each chunk, poll until done, save URLs.
 *
 * Safety: uses DB atomic lock ("tts_v5_fixing") so this script can NEVER run twice
 * in parallel. If you re-run while lock is held, it exits immediately.
 *
 * Recovery: task IDs are saved to /tmp/fix-v5-tasks.json so a restart resumes
 * polling without submitting new TTS jobs.
 */
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const TTS_BASE_URL = "https://api.ai33.pro";
const VIDEO_ID = 5;
const LOCK_VALUE = "tts_v5_fixing";
const TASK_FILE = "/tmp/fix-v5-tasks.json";

function splitIntoChunks(text: string, maxChars = 4000): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";
  for (const para of paragraphs) {
    if (current && (current + "\n\n" + para).length > maxChars) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function cancelTask(taskId: string, apiKey: string) {
  try {
    await fetch(`${TTS_BASE_URL}/v1/task/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({ task_ids: [taskId] }),
    });
  } catch {}
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  const apiKey = process.env.VIVOO_API_KEY;
  if (!dbUrl) throw new Error("DATABASE_URL not set");
  if (!apiKey) throw new Error("VIVOO_API_KEY not set");

  const sql = neon(dbUrl);

  // ── 1. Fetch video ───────────────────────────────────────────────────────
  const [video] = await sql`
    SELECT v.id, v.script, v.audio_url, v.voice_id, c.value as ch_voice_id
    FROM ah_videos v
    LEFT JOIN ah_channel_config c ON c.key = 'voice_id'
    WHERE v.id = ${VIDEO_ID}
  `;
  if (!video) throw new Error(`Video #${VIDEO_ID} not found`);

  const currentUrl = video.audio_url as string | null;

  // Already fixed? (real URL, not sentinel/lock)
  if (
    currentUrl &&
    currentUrl !== "openai:tts_done" &&
    currentUrl !== LOCK_VALUE &&
    !currentUrl.startsWith("tts_task:")
  ) {
    console.log(`✅ Video #${VIDEO_ID} already has real audio_url:\n${currentUrl}`);
    return;
  }

  // ── 2. Atomic lock ───────────────────────────────────────────────────────
  // Only claim if audio_url is the sentinel (not already locked by another run)
  if (currentUrl !== LOCK_VALUE) {
    const locked = await sql`
      UPDATE ah_videos SET audio_url = ${LOCK_VALUE}, updated_at = NOW()
      WHERE id = ${VIDEO_ID} AND audio_url = 'openai:tts_done'
      RETURNING id
    `;
    if (!locked.length) {
      // Another run already holds the lock or URL changed
      const [fresh] = await sql`SELECT audio_url FROM ah_videos WHERE id = ${VIDEO_ID}`;
      console.error(
        `❌ Could not acquire lock. Current audio_url="${fresh?.audio_url}". ` +
          `Another run may be active. Exiting.`
      );
      process.exit(1);
    }
    console.log("🔒 Lock acquired");
  } else {
    console.log("🔒 Lock already held by us — resuming");
  }

  const voiceId = video.voice_id || video.ch_voice_id;
  if (!voiceId) throw new Error("No voice_id configured");

  const script = video.script as string;
  const chunks = splitIntoChunks(script, 4000);
  console.log(`Script: ${script.length} chars → ${chunks.length} chunk(s), voice: ${voiceId}`);

  // ── 3. Load or create task ID state ──────────────────────────────────────
  type State = { taskIds: (string | null)[] };
  let state: State = { taskIds: new Array(chunks.length).fill(null) };

  if (fs.existsSync(TASK_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(TASK_FILE, "utf8")) as State;
      if (saved.taskIds?.length === chunks.length) {
        state = saved;
        console.log("📂 Resuming from saved task IDs:", state.taskIds);
      }
    } catch {}
  }

  const saveState = () => fs.writeFileSync(TASK_FILE, JSON.stringify(state));

  // ── 4. Submit any chunks that don't have a task ID yet ───────────────────
  for (let i = 0; i < chunks.length; i++) {
    if (state.taskIds[i]) {
      console.log(`Chunk ${i + 1}/${chunks.length}: already submitted (${state.taskIds[i]})`);
      continue;
    }
    console.log(`\nChunk ${i + 1}/${chunks.length} (${chunks[i].length} chars) — submitting...`);
    const res = await fetch(
      `${TTS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
        body: JSON.stringify({ text: chunks[i], model_id: "eleven_multilingual_v2" }),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Release lock before throwing
      await sql`UPDATE ah_videos SET audio_url = 'openai:tts_done', updated_at = NOW() WHERE id = ${VIDEO_ID}`;
      throw new Error(`AI33 submit HTTP ${res.status}: ${body}`);
    }
    const json = (await res.json()) as { task_id?: string };
    if (!json.task_id) {
      await sql`UPDATE ah_videos SET audio_url = 'openai:tts_done', updated_at = NOW() WHERE id = ${VIDEO_ID}`;
      throw new Error(`No task_id in response: ${JSON.stringify(json)}`);
    }
    state.taskIds[i] = json.task_id;
    saveState();
    console.log(`  → task_id: ${json.task_id}`);
  }

  // ── 5. Poll all chunks until done ────────────────────────────────────────
  const audioUrls: string[] = new Array(chunks.length).fill("");
  const pending = new Set(chunks.map((_, i) => i));

  console.log("\nPolling all chunks...");
  for (let attempt = 0; attempt < 120 && pending.size > 0; attempt++) {
    await sleep(5000);
    for (const i of [...pending]) {
      const taskId = state.taskIds[i]!;
      const r = await fetch(`${TTS_BASE_URL}/v1/task/${taskId}`, {
        headers: { "xi-api-key": apiKey },
      }).catch(() => null);
      if (!r?.ok) continue;
      const j = (await r.json()) as { status?: string; metadata?: { audio_url?: string }; error_message?: string };
      if (j.status === "done") {
        audioUrls[i] = j.metadata?.audio_url ?? "";
        pending.delete(i);
        console.log(`  Chunk ${i + 1} ✅ ${audioUrls[i].slice(0, 60)}`);
      } else if (["failed", "error", "cancelled"].includes(j.status ?? "")) {
        // Cancel this task and throw
        await cancelTask(taskId, apiKey);
        await sql`UPDATE ah_videos SET audio_url = 'openai:tts_done', updated_at = NOW() WHERE id = ${VIDEO_ID}`;
        throw new Error(`Chunk ${i + 1} task ${taskId} failed: ${j.error_message ?? j.status}`);
      } else {
        process.stdout.write(`  [${attempt + 1}] chunk ${i + 1} ${j.status}\r`);
      }
    }
  }

  if (pending.size > 0) {
    // Cancel remaining and release lock
    for (const i of pending) await cancelTask(state.taskIds[i]!, apiKey);
    await sql`UPDATE ah_videos SET audio_url = 'openai:tts_done', updated_at = NOW() WHERE id = ${VIDEO_ID}`;
    throw new Error(`Timed out waiting for chunks: ${[...pending].map((i) => i + 1).join(", ")}`);
  }

  // ── 6. Save to DB ─────────────────────────────────────────────────────────
  const finalUrl = audioUrls.length === 1 ? audioUrls[0] : JSON.stringify(audioUrls);
  await sql`UPDATE ah_videos SET audio_url = ${finalUrl}, updated_at = NOW() WHERE id = ${VIDEO_ID}`;

  // Clean up lock file
  try { fs.unlinkSync(TASK_FILE); } catch {}

  console.log(`\n✅ Video #${VIDEO_ID} audio_url saved (${audioUrls.length} chunk(s)):`);
  audioUrls.forEach((u, i) => console.log(`  [${i + 1}] ${u}`));
}

main().catch((err) => {
  console.error("\n❌", err.message || err);
  process.exit(1);
});
