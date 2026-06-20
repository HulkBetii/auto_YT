import { db } from "@/lib/db/index";
import { sql } from "drizzle-orm";
export {};
async function main() {
  const rows = await db.execute(sql`SELECT prompt_key, version, is_active, LEFT(prompt_text, 800) as preview FROM ah_prompt_versions WHERE prompt_key = 'S3' ORDER BY version`);
  for (const r of rows.rows) {
    console.log(`=== v${r.version} active=${r.is_active} ===`);
    console.log(r.preview);
    console.log("---");
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
