import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
const rows = await sql`
  SELECT id, version, is_active, template FROM prompt_versions
  WHERE prompt_key = 'P_desc' ORDER BY version DESC LIMIT 3`;
if (!rows.length) { console.log("No P_desc prompt found. Keys available:");
  const keys = await sql`SELECT DISTINCT prompt_key FROM prompt_versions ORDER BY prompt_key`;
  for (const k of keys) console.log(" ", k.prompt_key);
} else {
  for (const r of rows) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`P_desc v${r.version} (id=${r.id}) active=${r.is_active}`);
    console.log(`${"=".repeat(60)}`);
    console.log(r.template);
  }
}
process.exit(0);
