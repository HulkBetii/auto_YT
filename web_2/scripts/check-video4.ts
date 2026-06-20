export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

async function run() {
  const { db } = await import("../lib/db");
  const { ahVideos } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [v] = await db.select().from(ahVideos).where(eq(ahVideos.id, 4));
  console.log("status:", v.status);
  console.log("audioUrl:", v.audioUrl);
  console.log("voiceId:", v.voiceId);
  console.log("whisperTranscript:", v.whisperTranscript ? v.whisperTranscript.slice(0, 100) : null);
  const topic = v.chosenTopic as { title?: string } | null;
  console.log("topic:", topic?.title);
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
