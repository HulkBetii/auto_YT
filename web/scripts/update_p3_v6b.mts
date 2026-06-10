import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const [p3] = await sql`
  SELECT id, version, template FROM prompt_versions
  WHERE prompt_key = 'P3' AND is_active = true ORDER BY version DESC LIMIT 1
`;
if (!p3) { console.error("No active P3"); process.exit(1); }
console.log(`Found active P3 v${p3.version} (id=${p3.id})`);

// Fix stale reference: 総文字数行の直後が台本の1行目 no longer makes sense since
// we removed the 総文字数 header — the first line IS just the narration now.
const OLD = `- タイトル行（【人名】〇〇）も出力しない。総文字数行の直後が台本の1行目。`;
const NEW = `- タイトル行（【人名】〇〇）も出力しない。最初の1行目が台本本文（S1）の冒頭であること。`;

if (!p3.template.includes(OLD)) {
  console.log("ℹ️  Stale line not found — may already be fixed. Current 出力ルール section:");
  const idx = (p3.template as string).indexOf("出力ルール");
  console.log((p3.template as string).slice(idx, idx + 400));
  process.exit(0);
}

const newTemplate = (p3.template as string).replace(OLD, NEW);

// Deactivate current v6
await sql`UPDATE prompt_versions SET is_active = false WHERE prompt_key = 'P3' AND is_active = true`;

const [row] = await sql`
  INSERT INTO prompt_versions (prompt_key, version, template, is_active)
  SELECT 'P3', COALESCE(MAX(version), 0) + 1, ${newTemplate}, true
  FROM prompt_versions WHERE prompt_key = 'P3'
  RETURNING id, version
`;
console.log(`✓ P3 v${row.version} (id=${row.id}) activated`);
console.log(`  Fixed: "${OLD}"`);
console.log(`      → "${NEW}"`);
process.exit(0);
