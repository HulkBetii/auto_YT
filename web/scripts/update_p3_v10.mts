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
- 台本本文（S1フック）の1行目から直接始めること。
- 出力に含めてよいのは「台本のセリフ本文」と「<#X.X#>形式のポーズタグ」のみ。
- 以下は一切出力しない：前置き・説明文・承認文・タイトル行・セクション名・文字数報告・区切り線・番号・ラベル・マークダウン記号（**、#、━ など）
- 出力の最初の1文字が台本本文であること。それ以外から始まった場合は書き直すこと。

【出力前チェック（必須）】
- 総文字数：3000〜3500文字の範囲内か？【絶対厳守】文字数は出力に含めない。内部確認のみ。
  ※ 3000文字未満の場合は絶対に出力しないこと。S2とS4を加筆して必ず3000文字以上にすること。
  ※ 実績データより：1450文字→5分40秒、2500文字→8〜9分、3200文字→11〜12分が目安。
  ※ 競合の最高視聴動画は9〜13分帯に集中している。
- 一人称で統一されているか？三人称が混入していないか？
- 1文あたり最大45文字以内か？
- フック（S1）に数の予告を入れていないか？

【TTS最適化（AI33.PRO / MiniMax用）】
- 1文は最大45文字。漢字3文字以上連続→ひらがな。数字は漢数字。
- 感情タグは使用しない（出力に {calm} {serious} などのタグを入れないこと）
- ポーズタグ <#1.0#> <#1.2#> <#1.5#> <#2.0#> のみ使用。合計10〜15個を目安とする。
- ポーズタグは必ず文末（句点の直後）に付ける。タグだけの行は絶対に出力しない。
- 使いすぎ禁止：連続する短文に毎回タグを付けない。感情の大きな区切りにのみ使う。
- 禁止ワード：「素晴らしい」「感動的」「まさに」「バカ」「最悪」「クズ」「老害」

S6にCTA（チャンネル登録・通知ベル）は入れない。締めの言葉＋一人称のコメント設計のみ。

感情のリズム配分：
S1 フック：短く鋭く。視聴者の心を掴むまで止まらない。約200文字。
S2 偉人の苦境：一人称で過去の体験を回想する。場面を丁寧に描写する。急がない。約600文字。
S3 転換点①：ここが核心。一人称で悟りの瞬間を語る。約500文字。
　　視聴者が予想する展開と逆の方向に転換すること（視点の反転を必ず1つ入れる）。
　　例：「失敗・屈辱・孤独だと思っていた経験が、実は◯◯だった」という語り口。
　　この反転がS3にあるだけで中盤の離脱が大きく減る。反転のないS3は書き直すこと。
S4 転換点②：一人称で視聴者への教訓を直接語る。具体的なエピソードを1つ追加する。約700文字。
S5 解放：一人称で視聴者を承認する言葉。一文一文ゆっくりと。約450文字。
S6 締め：重みのある一言＋コメント質問。約150文字。

※ 各セクション±100文字は許容。感情の流れを最優先にすること。

ミッドポイントフック（必須）：
S4の冒頭（動画の中間点・約5〜6分付近）に必ず以下のいずれかを入れる。
① 「ここからが、本当に大切な話だ。」
② 「実は、わしが最も後悔していることを、今から話す。」
③ 「この話には、まだ続きがある。」
直後に<#1.5#>を入れて緊張感を再起動すること。

フック（S1）の禁止ルール：
- 数の予告禁止：「3つのこと」「5つの理由」など
- 結論の先出し禁止：冒頭で答えを言わない
- 説明・前置き禁止：フックは「問い」または「宣言」のみ
- 長すぎる禁止：S1は200文字以内。300文字超は絶対NG

全セクション連続して一気に最後まで出力する。途中で止めない。
目標文字数：3000〜3500文字（10〜13分）
※ 標準フォーマット：3000〜3200文字（10〜11分）
※ 対比フォーマット：3200〜3500文字（12〜13分）
※ 競合データより：9〜13分が視聴維持率の最適帯。15分超は離脱率が急増する。`;

await sql`UPDATE prompt_versions SET is_active = false WHERE prompt_key = 'P3' AND is_active = true`;

const [row] = await sql`
  INSERT INTO prompt_versions (prompt_key, version, template, is_active, created_by, change_reason)
  SELECT 'P3', COALESCE(MAX(version), 0) + 1, ${NEW_P3}, true, 'manual',
    'Add intentional twist requirement to S3 (転換点①): "視点の反転" must appear once — e.g. an experience that seemed like failure/defeat is reframed as the actual insight. Addresses P_score B-2 (予測できないツイスト +10pt) which was previously unguided luck. No other changes from v9.'
  FROM prompt_versions WHERE prompt_key = 'P3'
  RETURNING id, version
`;
console.log(`✓ P3 v${row.version} (id=${row.id}) activated`);
console.log("\nChanges vs v9:");
console.log("  - S3: added 3-line 視点の反転 requirement");
console.log("    → 'failure/humiliation/loneliness reframed as the actual insight'");
console.log("    → 'No twist in S3 = rewrite' instruction added");
console.log("  - Addresses P_score B-2 (10pt) — was random luck, now intentional");
console.log("  - Everything else identical to v9");
process.exit(0);
