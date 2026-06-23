export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });
async function main(){
  const { getDrEpisode } = await import("../lib/db/repo/episodes");
  const e = await getDrEpisode(1);
  const audio = (e?.audio as any[]) ?? [];
  const clips = audio.reduce((n,a)=>n+(a.clips?.length??0),0);
  const totalSec = audio.reduce((s,a)=>s+(a.clips??[]).reduce((x:number,c:any)=>x+c.durationSec,0),0);
  const byStatus:Record<string,number>={}; for(const a of audio) byStatus[a.status]=(byStatus[a.status]??0)+1;
  console.log("episode status:", e?.status);
  console.log("tracks by status:", byStatus);
  console.log("total clips:", clips, "| total audio:", Math.round(totalSec/60), "min");
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
