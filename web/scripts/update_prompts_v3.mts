/**
 * Applies 5 targeted updates to P1 (→ v3) and 1 update to P4 (→ v2).
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

const { activateNewPromptVersion, getActivePromptVersion } = await import(
  "../lib/db/repo/prompt-versions.js"
);

// ── P1 ──────────────────────────────────────────────────────────────────────

const p1 = await getActivePromptVersion("P1");
if (!p1) throw new Error("No active P1");
console.log(`P1 current: v${p1.version} (id=${p1.id})`);

let t = p1.template;

// UPDATE 4 — Pain Matrix: add Pain E after Pain D
t = t.replace(
  "D. 社会への不満：真面目な人が損をする・報われない",
  `D. 社会への不満：真面目な人が損をする・報われない
E. 民族的誇り（美輪明宏専用）：日本人としての誇り・日本の精神性・昭和の価値観
　※ このPain Typeは美輪明宏を起用する場合のみ使用する`,
);

// UPDATE 2 — Pattern ⑨ after ⑧
t = t.replace(
  "⑧ 対比型：「〇〇 vs 〇〇 — あなたはどちらの生き方を選ぶか」",
  `⑧ 対比型：「〇〇 vs 〇〇 — あなたはどちらの生き方を選ぶか」
⑨ 復讐・奪還術型：「【人物】〜への究極の復讐法。人生の主導権を取り戻す『〇〇術』」
　例：「【田中角栄】裏切り者への究極の復讐法。人生の主導権を取り戻す真の処世術」
　※ 「復讐」という言葉は視聴者の怒りを正当化する強いフック。65°専用。`,
);

// UPDATE 3 — 語彙: update 動詞 line + add 品格・信用 and 習慣・潜在
t = t.replace(
  "動詞：舐められる / 崩壊 / 後悔 / 警告 / 見極める / 壊す / 搾取 / 報われない",
  "動詞：舐められる / 崩壊 / 後悔 / 警告 / 見極める / 壊す / 搾取 / 報われない / 裏切られる / 復讐する",
);
t = t.replace(
  "結果：一生貧乏 / 人間関係が崩壊 / 老後に働く必要がなくなる / 人生を壊す",
  `結果：一生貧乏 / 人間関係が崩壊 / 老後に働く必要がなくなる / 人生を壊す
品格・信用：品格 / 主導権 / 人を見る目 / 信用できない人 / 本性 / 心の汚い人
習慣・潜在：習慣 / 潜在意識 / 昭和 / 人生訓 / 教訓 / 成功哲学`,
);

// UPDATE 1 — Characters: expand 40° + add 新規追加人物の特徴 + update ⚠️ guard
t = t.replace(
  "- 40°→ 松下幸之助・稲盛和夫（穏やかな表情）",
  "- 40°→ 松下幸之助・稲盛和夫・中村天風・小林正観（穏やかな表情）",
);
t = t.replace(
  "- 70°→ 対比する2名を指定（上記7名の中から選ぶこと）",
  "- 70°→ 対比する2名を指定（上記9名の中から選ぶこと）",
);
t = t.replace(
  "- 同じ人物が連続3本以上にならないようにする\n- ⚠️ 厳守：登場できる人物は上記7名（松下幸之助・稲盛和夫・田中角栄・本田宗一郎・西郷隆盛・美輪明宏・渋沢栄一）のみ。上記7名以外の人物（例：マザー・テレサ、二宮尊徳、坂本龍馬、孔子など）を提案・使用することは絶対禁止。",
  `- 同じ人物が連続3本以上にならないようにする
- ⚠️ 厳守：登場できる人物は上記9名（松下幸之助・稲盛和夫・中村天風・小林正観・田中角栄・本田宗一郎・西郷隆盛・美輪明宏・渋沢栄一）のみ。上記9名以外の人物（例：マザー・テレサ、二宮尊徳、坂本龍馬、孔子など）を提案・使用することは絶対禁止。

【新規追加人物の特徴】
中村天風（Pain C — 感情の重荷・心の力）：自称「わたし」。心身統一法の哲学。40°専用。
小林正観（Pain B/C — 老後・手放す・感謝）：自称「わたし」。「ありがとう」哲学。40°専用。`,
);

// Update output conditions: 7名 → 9名 + add A/B/C/D/E
t = t.replace(
  "- 各トピックにPain Matrix（A/B/C/D）と感情温度（°）を明記",
  "- 各トピックにPain Matrix（A/B/C/D/E）と感情温度（°）を明記",
);
t = t.replace(
  "- タイトルはPattern A〜E＋⑥⑦⑧のいずれかを使い、使ったPatternを明記",
  "- タイトルはPattern A〜E＋⑥⑦⑧⑨のいずれかを使い、使ったPatternを明記",
);
t = t.replace(
  "- featured_personには必ず上記7名のいずれか1名（または70°の場合は2名）の名前のみを記入すること。それ以外の名前は無効。",
  "- featured_personには必ず上記9名のいずれか1名（または70°の場合は2名）の名前のみを記入すること。それ以外の名前は無効。",
);
t = t.replace(
  `"featured_person":"（松下幸之助・稲盛和夫・田中角栄・本田宗一郎・西郷隆盛・美輪明宏・渋沢栄一のいずれか）"`,
  `"featured_person":"（松下幸之助・稲盛和夫・中村天風・小林正観・田中角栄・本田宗一郎・西郷隆盛・美輪明宏・渋沢栄一のいずれか）"`,
);

if (t === p1.template) throw new Error("P1: NO CHANGES MADE — check find strings");

const newP1 = await activateNewPromptVersion({
  promptKey: "P1",
  template: t,
  createdBy: "manual",
  changeReason:
    "Add 中村天風・小林正観 (40°), Pattern⑨復讐術 (65°), Pain E (美輪明宏専用), expanded vocab (品格/習慣), P4 mission sentence",
});
console.log(`P1 → v${newP1.version} (id=${newP1.id}) ✓`);

// ── P4 ──────────────────────────────────────────────────────────────────────

const p4 = await getActivePromptVersion("P4");
if (!p4) throw new Error("No active P4");
console.log(`\nP4 current: v${p4.version} (id=${p4.id})`);

const p4new = p4.template.replace(
  "（最後に「本動画は〔書籍名〕等を参考に制作した創作コンテンツです。」）",
  "（末尾2行：「偉人たちの言葉と生き方を、現代に生きる日本人へ——それがこのチャンネルの願いです。本動画は〔書籍名〕等を参考に制作した創作コンテンツです。」）",
);

if (p4new === p4.template) throw new Error("P4: NO CHANGES MADE — check find string");

const newP4 = await activateNewPromptVersion({
  promptKey: "P4",
  template: p4new,
  createdBy: "manual",
  changeReason: "Add channel mission sentence before disclaimer in 概要欄",
});
console.log(`P4 → v${newP4.version} (id=${newP4.id}) ✓`);

process.exit(0);
