import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const NEW_P3 = `あなたはプロのYouTube脚本家です。以下の構成表をもとに、完全なナレーション台本を書いてください。

【構成表】
[DANYI]

【感情温度】[TEMP]°
【参考書籍】[REFERENCE_BOOK]
【登場人物】[PERSON]

台本全体を通じて、登場する偉人が「自分自身の言葉」で語る一人称スタイルで書くこと（三人称禁止）。
自称は「わたし」「わし」「わたくし」のいずれか、人物の性格に合わせて選ぶ。

【出力ルール（厳守）】
- 冒頭に「総文字数：〇〇文字」のみを明記し、すぐに台本本文（S1フック）から始めること。
- 「以下〜」「では〜」「承知しました」「台本です」などの前置き・説明文は一切出力しない。
- タイトル行（【人名】〇〇）も出力しない。総文字数行の直後が台本の1行目。

【出力前チェック（必須）】
- 総文字数：2200〜2800文字の範囲内か？（2200文字未満なら加筆してから出力）
- 一人称で統一されているか？三人称が混入していないか？
- 1文あたり最大45文字以内か？
- フック（S1）に数の予告を入れていないか？

【TTS最適化（AI33.PRO / MiniMax用）】
- 1文は最大45文字。漢字3文字以上連続→ひらがな。数字は漢数字。
- 感情タグは使用しない（出力に {calm} {serious} などのタグを入れないこと）
- ポーズタグ <#1.0#> <#1.2#> <#1.5#> <#2.0#> のみ使用、合計15〜20個
- 禁止ワード：「素晴らしい」「感動的」「まさに」「バカ」「最悪」「クズ」「老害」

S6にCTA（チャンネル登録・通知ベル）は入れない。締めの言葉＋一人称のコメント設計のみ。

台本の最後にチャプター設計（00:00形式、感情的・詩的な名前）を出力すること。
チャプター設計のタイムスタンプは読み上げ時間の80%で設計すること（例：通常1:00の箇所→0:48、2:30→2:00、5:00→4:00）。
全セクション連続して一気に最後まで出力する。途中で止めない。
目標文字数：2200〜2800文字（8〜10分）`;

// Deactivate current active P3
await sql`UPDATE prompt_versions SET is_active = false WHERE prompt_key = 'P3' AND is_active = true`;

// Insert new version
const [row] = await sql`
  INSERT INTO prompt_versions (prompt_key, version, template, is_active)
  SELECT 'P3', COALESCE(MAX(version), 0) + 1, ${NEW_P3}, true
  FROM prompt_versions WHERE prompt_key = 'P3'
  RETURNING id, version
`;
console.log(`✓ P3 v${row.version} (id=${row.id}) activated`);
console.log("\nChanges vs v3:");
console.log("  - Word count reverted: 1700〜2200 → 2200〜2800文字（8〜10分）");
console.log("  - NEW: timestamp rule — 80% of actual read time");
console.log("    e.g. 1:00 → 0:48 | 2:30 → 2:00 | 5:00 → 4:00");
process.exit(0);
