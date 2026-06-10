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

let t: string = p3.template;

// Fix 1: Strengthen the TTS pause tag rule — forbid standalone tags + cap at 20
const OLD_TTS = `- ポーズタグ <#1.0#> <#1.2#> <#1.5#> <#2.0#> のみ使用、合計15〜20個`;
const NEW_TTS = `- ポーズタグ <#1.0#> <#1.2#> <#1.5#> <#2.0#> のみ使用、合計15〜20個（厳守）
- ポーズタグは必ず文末に付ける。タグだけの行（例：<#1.0#> のみの行）は絶対に出力しない`;

if (!t.includes(OLD_TTS)) { console.error("❌ Pause tag line not found"); process.exit(1); }
t = t.replace(OLD_TTS, NEW_TTS);

// Fix 2: Strengthen the char count check — make it even more explicit
const OLD_CHECK = `- 総文字数：3000〜3500文字の範囲内か？
  ※ 3000文字未満の場合は出力しないこと。S2またはS4を加筆してから出力する。`;
const NEW_CHECK = `- 総文字数：3000〜3500文字の範囲内か？【絶対厳守】
  ※ 3000文字未満の場合は絶対に出力しないこと。S2とS4を加筆して必ず3000文字以上にすること。
  ※ 1365文字などの短い出力は完全にNG。必ず数えてから出力すること。`;

if (!t.includes(OLD_CHECK)) { console.error("❌ Char check line not found"); process.exit(1); }
t = t.replace(OLD_CHECK, NEW_CHECK);

// Deactivate current
await sql`UPDATE prompt_versions SET is_active = false WHERE prompt_key = 'P3' AND is_active = true`;

const [row] = await sql`
  INSERT INTO prompt_versions (prompt_key, version, template, is_active)
  SELECT 'P3', COALESCE(MAX(version), 0) + 1, ${t}, true
  FROM prompt_versions WHERE prompt_key = 'P3'
  RETURNING id, version
`;
console.log(`✓ P3 v${row.version} (id=${row.id}) activated`);
console.log("\nChanges vs v7:");
console.log("  - Pause tags: added rule forbidding standalone tag-only lines");
console.log("  - Char count check: strengthened with 【絶対厳守】 + explicit bad example");
process.exit(0);
