import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const key = process.argv[2] ?? "P1"; // pass e.g. "P3" as arg
const [row] = await sql`
  SELECT id, prompt_key, version, template
  FROM prompt_versions WHERE prompt_key = ${key} AND is_active = true LIMIT 1
`;
if (!row) { console.log(`No active ${key} prompt.`); process.exit(0); }
console.log(`=== ${row.prompt_key} v${row.version} (id=${row.id}) ===\n`);
console.log(row.template);
process.exit(0);
