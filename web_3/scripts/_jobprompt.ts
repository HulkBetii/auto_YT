export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });
async function main(){
  const { db } = await import("../lib/db");
  const { drJobs } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [j] = await db.select().from(drJobs).where(eq(drJobs.id, Number(process.argv[2])));
  console.log("stage:", j?.stage, "| prompt head 400:");
  console.log((j?.promptText ?? "").slice(0,400));
  console.log("... | has [SCENE_INPUT]?", (j?.promptText??"").includes("[SCENE_INPUT]"), "| SCENE NAME line:", /SCENE NAME:/.test(j?.promptText??""));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
