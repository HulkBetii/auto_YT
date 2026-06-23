export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { db } = await import("../lib/db");
  const { drEpisodes, drJobs } = await import("../lib/db/schema");
  const eps = await db.select().from(drEpisodes);
  const jobs = await db.select().from(drJobs);
  for (const e of eps) {
    const specs = Array.isArray(e.trackSpecs) ? (e.trackSpecs as unknown[]).length : 0;
    const audio = Array.isArray(e.audio) ? (e.audio as unknown[]).length : 0;
    console.log(`EP#${e.id} status=${e.status} specs=${specs} audio=${audio} ytTitle=${e.ytTitle ?? "-"}`);
  }
  for (const j of jobs) {
    console.log(`  job#${j.id} ${j.stage} ${j.status}${j.errorMessage ? " ERR=" + j.errorMessage.slice(0, 80) : ""}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
