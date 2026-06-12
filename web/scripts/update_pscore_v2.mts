import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const NEW_PSCORE = `以下の動画素材（構成・台本・SEOパッケージ）を、下記のスコアカードに基づいて採点してください。

【動画素材】
[CONTENT]

【スコアカード（100点満点、80点以上で公開可）】
A — HOOK（25点）
- 30秒の冒頭が断言・命令形（疑問文でない） +5
- 偉人への自然な橋渡し +5
- 30秒読み上げて続きを聞きたくなるか +15

B — 感情（30点）
- 承認フレーズが2つ以上 +10
- 予測できないツイスト・視点がある +10
- 参考書籍に最低1回言及 +10

C — TTS（25点）
- 45文字を超える文がない +5
- ポーズタグ合計10〜15個、<#0.3#>/<#0.5#>不使用、1段落3個以内 +10
- S6に重みのある締め＋一人称のコメント質問、CTA subscribeなし +10

D — SEO（20点）
- タイトルが【人物名】で始まり、タイトルPatternを明記して正しく使用（A〜E・⑥〜⑨いずれも可） +5
- 最初の30文字に強い感情語または禁止命令 +5
- サムネイル3行、各行8文字以内、人物名なし +5
- 概要欄冒頭2行が断言形式で痛みに触れている +5

出力形式：JSON
{"total_score": 0, "breakdown": {"hook": 0, "emotion": 0, "tts": 0, "seo": 0}, "issues": ["..."], "verdict": "publish|revise|rewrite"}

判定基準：80点以上=publish／60〜79点=revise／60点未満=rewrite`;

await sql`UPDATE prompt_versions SET is_active = false WHERE prompt_key = 'P_score' AND is_active = true`;

const [row] = await sql`
  INSERT INTO prompt_versions (prompt_key, version, template, is_active, created_by, change_reason)
  SELECT 'P_score', COALESCE(MAX(version), 0) + 1, ${NEW_PSCORE}, true, 'manual',
    'Fix criteria D-1: "Pattern A〜E" → "Pattern A〜E・⑥〜⑨いずれも可" to match P1 v3 which generates patterns ⑥⑦⑧⑨. Fix criteria C TTS: pause tag count 15〜20 → 10〜15 to match P3 v9 cap.'
  FROM prompt_versions WHERE prompt_key = 'P_score'
  RETURNING id, version
`;
console.log(`✓ P_score v${row.version} (id=${row.id}) activated`);
console.log("\nChanges vs v1:");
console.log("  - D-1: 'Pattern A〜E' → 'A〜E・⑥〜⑨いずれも可' (matches P1 v3 output)");
console.log("  - C: pause tag count 15〜20 → 10〜15 (matches P3 v9 cap of 10-15)");
process.exit(0);
