import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const [p3] = await sql`
  SELECT id, version, template FROM prompt_versions
  WHERE prompt_key = 'P3' AND is_active = true
  ORDER BY version DESC LIMIT 1
`;
if (!p3) { console.error("No active P3"); process.exit(1); }
console.log(`Found active P3 v${p3.version} (id=${p3.id})`);

let t: string = p3.template;

// 1. Remove 総文字数 output instruction — output should start directly with S1
const OLD_OUTPUT_RULE = `- 冒頭に「総文字数：〇〇文字」のみを明記し、すぐに台本本文（S1フック）から始めること。`;
const NEW_OUTPUT_RULE = `- 台本本文（S1フック）から直接始めること。数字・タイトル行・前置きは一切出力しない。`;
if (!t.includes(OLD_OUTPUT_RULE)) {
  console.error("❌ Could not find 総文字数 output rule. Aborting."); process.exit(1);
}
t = t.replace(OLD_OUTPUT_RULE, NEW_OUTPUT_RULE);

// 2. Remove chapter design output instructions (two lines before the final "全セクション" line)
const OLD_CHAPTER = `台本の最後にチャプター設計（00:00形式、感情的・詩的な名前）を出力すること。\nチャプター設計のタイムスタンプは読み上げ時間の80%で設計すること（例：通常1:00の箇所→0:48、2:30→2:00、5:00→4:00）。\n`;
if (!t.includes(OLD_CHAPTER)) {
  console.error("❌ Could not find chapter design lines. Current template around that area:");
  const idx = t.indexOf("チャプター");
  console.error(t.slice(Math.max(0, idx - 50), idx + 200));
  process.exit(1);
}
t = t.replace(OLD_CHAPTER, "");

// Deactivate current
await sql`UPDATE prompt_versions SET is_active = false WHERE prompt_key = 'P3' AND is_active = true`;

// Insert v6
const [row] = await sql`
  INSERT INTO prompt_versions (prompt_key, version, template, is_active)
  SELECT 'P3', COALESCE(MAX(version), 0) + 1, ${t}, true
  FROM prompt_versions WHERE prompt_key = 'P3'
  RETURNING id, version
`;
console.log(`✓ P3 v${row.version} (id=${row.id}) activated`);
console.log("\nChanges vs v5:");
console.log("  - Removed 総文字数 header from output (pure TTS narration only)");
console.log("  - Removed chapter timeline output (moved to P4)");
process.exit(0);
