export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });
import { writeFileSync } from "fs";
async function main(){
  const { getActiveDrPromptVersion } = await import("../lib/db/repo/prompt-versions");
  const keys = ["D0","D1","D2A","D2B","D2C","D3","D4"];
  let out = "";
  for (const k of keys){
    const r = await getActiveDrPromptVersion(k);
    out += `\n@@@${k}|v${r?.version}@@@\n${r?.template ?? ""}\n`;
  }
  writeFileSync("/tmp/dr_prompts_full.txt", out);
  console.log("wrote", out.length, "chars");
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
