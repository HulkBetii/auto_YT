export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });
async function main(){
  const { db } = await import("../lib/db");
  const { sql } = await import("drizzle-orm");
  const { retryDrJob } = await import("../lib/db/repo/jobs");
  const { updateDrEpisodeStatus } = await import("../lib/db/repo/episodes");
  await db.execute(sql`DELETE FROM dr_channel_config WHERE key = 'dr_conversation_url:2'`);
  const r = await retryDrJob(9);
  await updateDrEpisodeStatus(2, "d1_pending");
  console.log("cleared conv url:2; retried job#9 →", r?.status, "; episode 2 → d1_pending");
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
