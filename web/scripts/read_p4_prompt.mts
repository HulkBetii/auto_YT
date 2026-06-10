import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
const rows = await sql`SELECT id, version, template FROM prompt_versions WHERE prompt_key = 'P4' ORDER BY version DESC LIMIT 2`;
for (const r of rows) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`P4 v${r.version} (id=${r.id})`);
  console.log(`${"=".repeat(60)}`);
  console.log(r.template);
}
process.exit(0);
