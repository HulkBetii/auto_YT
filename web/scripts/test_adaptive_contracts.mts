import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { config } from "dotenv";

import { ADAPTIVE_PROMPTS } from "./adaptive-prompts.js";

config({ path: ".env.local" });

const { parseP6Output, formatBatchTable } = await import("../lib/pipeline/chain.js");
const { normalizeDupText, titleSkeleton } = await import("../lib/pipeline/antiDuplication.js");
const {
  FIXED_PERSONA_NAME,
  FIXED_PERSONA_TITLE_PREFIX,
  FORBIDDEN_PERSONA_NAMES,
  normalizeFixedPersonaTitle,
  normalizeFixedPersonaTopic,
  validateFixedPersonaP1Template,
} = await import("../lib/pipeline/fixedPersona.js");
const { parseP3ForTTS, lookupVoiceInMap } = await import("../lib/pipeline/tts.js");

const p3Raw = `総文字数：3200文字
【タイトル】dummy
今日は、あなたに一つだけ確かめてほしいことがあります。<#1.0#>
{calm}コメント欄に「ありがとう」と残してください。<#1.2#>

チャプター設計
00:00　dummy`;

const parsedP3 = parseP3ForTTS(p3Raw);
assert(!parsedP3.includes("総文字数"));
assert(!parsedP3.includes("チャプター設計"));
assert(!parsedP3.includes("{calm}"));
assert(parsedP3.includes("<#1.0#>"));
assert(parsedP3.includes("<#1.2#>"));

const noisyP3 = [
  "Opening<br>line.<#1.0#>",
  ...Array.from({ length: 20 }, (_, i) => `Sentence ${i}.<#1.2#>`),
  "Bad pause.<#3.0#><em>html</em>",
].join("\n");
const noisyParsedP3 = parseP3ForTTS(noisyP3);
assert(!noisyParsedP3.includes("<br"));
assert(!noisyParsedP3.includes("<em>"));
assert(!noisyParsedP3.includes("<#3.0#>"));
assert.equal((noisyParsedP3.match(/<#[^>]+#>/g) ?? []).length, 15);

const p6 = parseP6Output(`分析レポート

${ADAPTIVE_PROMPTS.P1}`);
assert.equal(p6.report, "分析レポート");
assert(p6.newP1Template.startsWith("あなたはYouTubeチャンネルのコンテンツストラテジストです。"));
assert.deepEqual(validateFixedPersonaP1Template(p6.newP1Template), { ok: true });
assert.equal(
  validateFixedPersonaP1Template(ADAPTIVE_PROMPTS.P1.replaceAll(FIXED_PERSONA_NAME, "松下幸之助")).ok,
  false,
);

const normalizedTopic = normalizeFixedPersonaTopic({
  topic: "猫が好きな人の隠れた性格",
  title: "【松下幸之助】猫が好きな人、実は心が深い",
  featured_person: "松下幸之助",
});
assert.equal(normalizedTopic.featured_person, FIXED_PERSONA_NAME);
assert.equal(normalizedTopic.title, `${FIXED_PERSONA_TITLE_PREFIX}猫が好きな人、実は心が深い`);
assert.equal(
  normalizeFixedPersonaTitle("60代で先延ばしにしてはいけないこと"),
  `${FIXED_PERSONA_TITLE_PREFIX}60代で先延ばしにしてはいけないこと`,
);

assert(ADAPTIVE_PROMPTS.P1.includes(`"featured_person":"${FIXED_PERSONA_NAME}"`));
assert(ADAPTIVE_PROMPTS.P1.includes(FIXED_PERSONA_TITLE_PREFIX));
assert(!ADAPTIVE_PROMPTS.P1.includes("【人物候補】"));
for (const forbiddenName of FORBIDDEN_PERSONA_NAMES) {
  assert(!ADAPTIVE_PROMPTS.P1.includes(forbiddenName), `P1 contains forbidden persona ${forbiddenName}`);
}

const batch = formatBatchTable([
  {
    no: 1,
    title: "【美輪明宏】猫が好きな人、実は心が深い",
    pattern: "T1",
    pain: "F",
    temp: "45",
    person: "美輪明宏",
    archetype: "BEHAVIOR_DECODING",
    hookType: "SELF_RECOGNITION",
    commentMode: "IDENTITY_DECLARATION",
    personaMode: "DECODER",
    listCount: "0",
    corePromise: "猫好きな人の隠れた性格を知る",
    lengthMin: "",
    ctrPct: "4.10",
    avdPct: "42",
    commentPct: "0.60",
    likePct: "3.20",
  },
]);
assert(batch.includes("Archetype"));
assert(batch.includes("CorePromise"));

assert.equal(normalizeDupText("【美輪明宏】 猫が好きな人、実は..."), "猫が好きな人実は");
assert.equal(
  titleSkeleton("【美輪明宏】猫が好きな人に共通する意外な特徴5選"),
  titleSkeleton("【美輪明宏】猫が好きな人に共通する意外な特徴7選"),
);

for (const [key, template] of Object.entries(ADAPTIVE_PROMPTS)) {
  assert(template.length > 500, `${key} prompt is unexpectedly short`);
}

assert(ADAPTIVE_PROMPTS.P4.includes(`必ず${FIXED_PERSONA_TITLE_PREFIX}`));
assert(ADAPTIVE_PROMPTS.P5.includes("person allocation、persona rotationは分析しない"));
assert(ADAPTIVE_PROMPTS.P6.includes("人物追加、人物削減、persona rotation、別voice提案は禁止"));

const antiDupSource = readFileSync("lib/pipeline/antiDuplication.ts", "utf8");
assert(!antiDupSource.includes("anti_dup_person_lookback"));
assert(!antiDupSource.includes("anti_dup_pain_lookback"));
assert(!antiDupSource.includes("v.featuredPerson"));

assert.equal(
  lookupVoiceInMap({ [FIXED_PERSONA_NAME]: "clone_2222532", "Miwa Akihiro": "clone_2222532" }, FIXED_PERSONA_NAME),
  "clone_2222532",
);
assert.equal(lookupVoiceInMap({}, FIXED_PERSONA_NAME), null);

for (const header of [
  "タイトル候補",
  "サムネイルテキスト",
  "概要欄テキスト",
  "タグリスト",
  "Shortsスクリプト",
  "コメント返信テンプレート",
  "投稿戦略",
  "チャプター設計",
]) {
  assert(ADAPTIVE_PROMPTS.P4.includes(header), `P4 missing ${header}`);
}

console.log("adaptive contract checks passed");
