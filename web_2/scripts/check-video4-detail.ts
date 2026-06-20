export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

async function run() {
  const { db } = await import("../lib/db");
  const { ahVideos } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [v] = await db.select().from(ahVideos).where(eq(ahVideos.id, 4));
  const topic = v.chosenTopic as { title?: string } | null;
  console.log("topic:", topic?.title);
  console.log("script (first 200):", v.script ? v.script.slice(0, 200) : "NULL");
  console.log("scriptSlug:", v.scriptSlug);
  console.log("audioUrl:", v.audioUrl);
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
