export const REQUIRED_MODEL = "GPT-5.6 Sol";
export const AUDIT_EFFORT = "High";
export const OUTLINE_EFFORT = "High";
export const SCRIPT_EFFORT = "High";
export const REVIEW_EFFORT = "High";

export const DEFAULT_PROMPT_TEMPLATES = {
  source_audit: `あなたは韓国語・日本語の動画コンテンツ分析のエキスパートです。
以下の提供された素材（動画情報・トランスクリプト）を精読し、JSON形式で本質的なファクト、感情フック、核心メッセージを抽出してください。

入力素材:
[TRANSCRIPT]

出力JSONフォーマット:
{
  "summary": "動画の全体要約（日本語）",
  "core_theme": "核心テーマ",
  "emotional_triggers": ["視聴者の感情を動かす要素1", "要素2"],
  "key_facts": [
    {"id": "F1", "fact": "具体的な事実やエピソード", "importance": "high"}
  ],
  "cultural_adaptation_notes": "韓国の文脈から日本の視聴者向けにローカライズする際の注意点"
}`,

  outline: `あなたは日韓コンテンツローカライズの最高峰ディレクターです。
韓国語ソースの核心的価値を活かしつつ、日本のYouTube視聴者に深く刺さる構成案（S1〜S6）を設計してください。

入力情報:
要約とファクト: [SOURCE_AUDIT]
適応スタイル: [ADAPTATION_MODE]

構成要件:
- S1: 導入・フック（共鳴と問いかけ）
- S2: 問題提起と背景
- S3: 核心となる洞察・視点の転換（Twist）
- S4: 具体例・人生への応用（Midpoint Hookを含む）
- S5: 心に染み入る教訓・解放
- S6: 結び・視聴者への問いかけ（コメント誘発）

出力JSONフォーマット:
{
  "title_proposals": ["タイトル候補1", "タイトル候補2", "タイトル候補3"],
  "target_persona": "想定視聴者層",
  "sections": [
    {"index": 1, "kind": "hook", "title": "...", "objective": "...", "key_points": ["..."]},
    {"index": 2, "kind": "problem", "title": "...", "objective": "...", "key_points": ["..."]},
    {"index": 3, "kind": "twist", "title": "...", "objective": "...", "key_points": ["..."]},
    {"index": 4, "kind": "application", "title": "...", "objective": "...", "key_points": ["..."]},
    {"index": 5, "kind": "resolution", "title": "...", "objective": "...", "key_points": ["..."]},
    {"index": 6, "kind": "conclusion", "title": "...", "objective": "...", "key_points": ["..."]}
  ]
}`,

  script_section: `構成案に基づき、日本の視聴者の心に響く自然で洗練された語り口（ナレーション）を作成してください。
直訳ではなく、感情が伝わる表現に完全にリライトしてください。

セクション情報:
[SECTION_OUTLINE]

全体文脈:
[FULL_OUTLINE]

要件:
- 自然で引き込まれる日本語のナレーション文
- 必要に応じて息継ぎや強調のためのタグ <#1.0#> を適切に配置
- 機械翻訳感を完全に排除し、人間味のある語り口にする`,

  fidelity_review: `完成した日本語原稿が元のソースの核心的価値を保持しつつ、日本の視聴者向けに最高水準でローカライズされているか厳格に審査してください。

原稿:
[FINAL_SCRIPT]

審査基準:
1. 感情共鳴度 (0-25)
2. 日本語としての自然さと格調 (0-30)
3. 原作の核心メッセージ保持 (0-25)
4. リテンション・構成力 (0-20)

出力JSONフォーマット:
{
  "total_score": 90,
  "verdict": "pass", // "pass" | "repair"
  "breakdown": {
    "emotional_resonance": 23,
    "linguistic_naturalness": 28,
    "message_fidelity": 23,
    "retention_structure": 18
  },
  "feedback": "講評"
}`
};
