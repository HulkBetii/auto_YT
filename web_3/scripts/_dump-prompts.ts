export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });
async function main(){
  const { getActiveDrPromptVersion } = await import("../lib/db/repo/prompt-versions");
  const keys = ["D0","D1","D2A","D2B","D2C","D3","D4"];
  for (const k of keys){
    const r = await getActiveDrPromptVersion(k);
    console.log(`### ${k} v${r?.version} :: ${r?.changeReason ?? ""} :: ${r?.template?.length ?? 0} chars`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
