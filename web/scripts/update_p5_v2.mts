import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const NEW_P5 = `以下のYouTube動画のアナリティクスデータをもとに、次の動画を改善する提案をしてください。

【動画情報】
タイトル：[VIDEO_TITLE]
タイトルPattern：[PATTERN_USED]
感情温度：[TEMP]°
Pain Type：[PAIN_TYPE]
登場人物：[PERSON]
動画の長さ：[LENGTH]分

【YouTube Studioデータ（投稿48時間後）】
- CTR：[CTR]%　- AVD：[AVD]%　- コメント率：[COMMENT_RATE]%　- いいね率：[LIKE_RATE]%
- 最も視聴離脱が多かった時間：[DROP_TIME]分[DROP_SEC]秒
- トラフィックソース上位3つ：[SOURCE_1] / [SOURCE_2] / [SOURCE_3]

【判断基準】CTR目標4%以上／AVD目標40%以上／コメント率0.5%以上／いいね率3%以上
【注意】再生数100回未満は統計的信頼性が低い。100回未満の場合は「分析より投稿継続を優先」と明記。
※ 空白の項目（[LENGTH]、[DROP_TIME]、[DROP_SEC]、[SOURCE_1]〜[SOURCE_3]）がある場合は、その分析項目を「データなし — 省略」と1行で明記して次の項目へ進むこと。

【分析してほしいこと】
1. データ診断：何が機能して、何が機能しなかったか
2. CTRが低い場合：別Patternのタイトル改善案を3パターン（Pattern名明記）
3. AVDが低い場合：離脱時間データがあれば[DROP_TIME]分付近の問題を推測し改善策を示す。データがなければ台本構成の観点から改善案を提示
4. コメント率が低い場合：コメント設計の改善案
5. 次の動画で変えるべきことを優先順位順に3つ
6. 同じPain Type（[PAIN_TYPE]）で次に試すべきトピックを3件（温度・人物・Pattern指定）

出力：箇条書き、日本語で`;

await sql`UPDATE prompt_versions SET is_active = false WHERE prompt_key = 'P5' AND is_active = true`;

const [row] = await sql`
  INSERT INTO prompt_versions (prompt_key, version, template, is_active, created_by, change_reason)
  SELECT 'P5', COALESCE(MAX(version), 0) + 1, ${NEW_P5}, true, 'manual',
    'Graceful degrade: empty placeholders (LENGTH, DROP_TIME, DROP_SEC, SOURCE_1-3) are now skipped with "データなし — 省略" instead of being passed as blank strings. Item 3 updated to offer structural analysis fallback when drop-time data is unavailable.'
  FROM prompt_versions WHERE prompt_key = 'P5'
  RETURNING id, version
`;
console.log(`✓ P5 v${row.version} (id=${row.id}) activated`);
console.log("\nChanges vs v1:");
console.log("  - Added ※ note: blank placeholders → skip with 'データなし — 省略'");
console.log("  - Item 3 (AVD低): conditional — use DROP_TIME if present, else structural fallback");
process.exit(0);
