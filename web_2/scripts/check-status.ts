export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

async function check() {
  const { db } = await import("../lib/db");
  const { ahVideos, ahJobs } = await import("../lib/db/schema");
  const { eq, desc } = await import("drizzle-orm");

  const videos = await db.select().from(ahVideos).orderBy(desc(ahVideos.id)).limit(3);
  for (const v of videos) {
    const jobs = await db.select().from(ahJobs).where(eq(ahJobs.videoId, v.id)).orderBy(desc(ahJobs.id));
    const topic = v.chosenTopic as { title?: string } | null;
    console.log(`Video #${v.id} | status=${v.status} | "${topic?.title ?? "(no topic yet)"}"`);
    for (const j of jobs) {
      const err = j.errorMessage ? ` | err=${j.errorMessage.slice(0, 80)}` : "";
      const consumed = j.consumedAt ? " [consumed]" : "";
      console.log(`  Job #${j.id} stage=${j.stage} status=${j.status}${consumed}${err}`);
    }
  }
  process.exit(0);
}

check().catch((e) => { console.error(e); process.exit(1); });
