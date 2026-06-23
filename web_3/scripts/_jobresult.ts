export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });
async function main(){
  const { db } = await import("../lib/db");
  const { drJobs } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const id = Number(process.argv[2] ?? 9);
  const [j] = await db.select().from(drJobs).where(eq(drJobs.id, id));
  console.log("stage:", j?.stage, "status:", j?.status, "len:", j?.result?.length);
  console.log("=== result (first 1500) ===");
  console.log((j?.result ?? "").slice(0, 1500));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
