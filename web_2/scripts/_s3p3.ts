import { db } from "@/lib/db/index";
import { sql } from "drizzle-orm";
export {};
async function main() {
  const cols = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'ah_prompt_versions'`);
  console.log("Columns:", cols.rows.map((r: Record<string, unknown>) => r.column_name).join(", "));
  const rows = await db.execute(sql`SELECT version, is_active, LEFT(system_prompt, 600) as s FROM ah_prompt_versions WHERE prompt_key = 'S3' ORDER BY version`);
  for (const r of rows.rows) {
    console.log(`=== v${r.version} active=${r.is_active} ===\n${r.s}\n---`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
