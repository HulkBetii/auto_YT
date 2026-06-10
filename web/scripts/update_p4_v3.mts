import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const [p4] = await sql`
  SELECT id, version, template FROM prompt_versions
  WHERE prompt_key = 'P4' AND is_active = true
  ORDER BY version DESC LIMIT 1
`;
if (!p4) { console.error("No active P4"); process.exit(1); }
console.log(`Found active P4 v${p4.version} (id=${p4.id})`);

// Append chapter design section at the end
const CHAPTER_SECTION = `\n■ チャプター設計（00:00形式）— 感情的・詩的なチャプター名。タイムスタンプは台本の読み上げ時間の75%で計算すること（例：通常1:00→0:45、2:00→1:30、5:00→3:45、10:00→7:30）。読み上げ速度の目安：1450文字≒5分40秒、3000文字≒11分。`;

// Guard: don't append twice
if ((p4.template as string).includes("チャプター設計")) {
  console.error("❌ P4 already contains チャプター設計. Check template manually."); process.exit(1);
}

const newTemplate = (p4.template as string).trimEnd() + CHAPTER_SECTION;

// Deactivate current
await sql`UPDATE prompt_versions SET is_active = false WHERE prompt_key = 'P4' AND is_active = true`;

// Insert v3
const [row] = await sql`
  INSERT INTO prompt_versions (prompt_key, version, template, is_active)
  SELECT 'P4', COALESCE(MAX(version), 0) + 1, ${newTemplate}, true
  FROM prompt_versions WHERE prompt_key = 'P4'
  RETURNING id, version
`;
console.log(`✓ P4 v${row.version} (id=${row.id}) activated`);
console.log("\nChanges vs v2:");
console.log("  - Added チャプター設計 section (timestamps at 75% of reading time)");
console.log("  + " + CHAPTER_SECTION.trim());
process.exit(0);
