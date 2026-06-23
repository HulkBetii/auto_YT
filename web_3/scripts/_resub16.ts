export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });
async function main(){
  const { getDrEpisode, updateDrEpisodeFields, releaseEpisodeSunoLock } = await import("../lib/db/repo/episodes");
  const e = await getDrEpisode(1);
  const audio = (e?.audio as any[]) ?? [];
  for (const a of audio) if (a.status === "running" && (!a.clips || a.clips.length === 0)) { a.status = "pending"; a.taskId = null; a.errorMessage = undefined; }
  await updateDrEpisodeFields(1, { audio });
  await releaseEpisodeSunoLock(1);
  console.log("reset stuck running -> pending:", audio.filter((a:any)=>a.status==="pending").length, "pending");
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
