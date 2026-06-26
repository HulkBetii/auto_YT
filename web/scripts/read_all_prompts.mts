import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const rows = await sql`
  SELECT prompt_key, version, is_active, LENGTH(template) as len, template
  FROM prompt_versions WHERE is_active = true ORDER BY prompt_key`;

for (const r of rows) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[${r.prompt_key}] v${r.version} — ${r.len} chars`);
  console.log("=".repeat(70));
  console.log(r.template);
}
process.exit(0);
