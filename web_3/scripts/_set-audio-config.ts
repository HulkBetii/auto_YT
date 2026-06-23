export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });
async function main(){
  const { setDrConfigValue } = await import("../lib/db/repo/channel-config");
  await setDrConfigValue("min_clip_sec", "60");
  await setDrConfigValue("crossfade_sec", "3");
  console.log("set min_clip_sec=60, crossfade_sec=3");
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
