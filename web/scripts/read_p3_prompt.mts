import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const rows = await sql`
  SELECT id, version, created_at, template
  FROM prompt_versions
  WHERE prompt_key = 'P3'
  ORDER BY version DESC
  LIMIT 3
`;
for (const r of rows) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`P3 v${r.version} (id=${r.id}) — ${r.created_at}`);
  console.log(`${"=".repeat(60)}`);
  console.log(r.template);
}
process.exit(0);
