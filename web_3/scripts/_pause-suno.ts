export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });
async function main(){
  const { setDrConfigValue } = await import("../lib/db/repo/channel-config");
  await setDrConfigValue("suno_paused", "true");
  console.log("suno_paused=true (safe default)");
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
