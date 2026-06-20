import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
const env = readFileSync(".env.local", "utf-8");
const dbUrl = env.split("\n").find(l => l.startsWith("DATABASE_URL="))?.replace("DATABASE_URL=", "").replace(/^["']|["']$/g, "").trim();
const sql = neon(dbUrl!);
type Topic = { title?: string };
(async () => {
  const [v] = await sql`SELECT id, status, chosen_topic, audio_url, whisper_transcript IS NOT NULL as has_transcript, updated_at FROM ah_videos WHERE id = 11`;
  const topic = (typeof v.chosen_topic === "string" ? JSON.parse(v.chosen_topic) : v.chosen_topic) as Topic | null;
  console.log("Video #11:", JSON.stringify({
    id: v.id, status: v.status,
    topic: topic?.title ?? null,
    audio: v.audio_url?.toString().slice(0,60) ?? null,
    hasTranscript: v.has_transcript,
    updatedAt: v.updated_at,
  }, null, 2));
  const jobs = await sql`SELECT id, stage, status, created_at, finished_at, error_message FROM ah_jobs WHERE video_id = 11 ORDER BY id`;
  console.log("Jobs:", JSON.stringify(jobs, null, 2));
})().catch(console.error);
