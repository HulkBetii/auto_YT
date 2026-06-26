// Quick unit test for parseP3ForTTS strip logic
import { parseP3ForTTS } from "../lib/pipeline/tts.js";

const sample = `総文字数：約二千六百文字

【稲盛和夫】尽くすな、それがあなたを壊している。

あなたは、よく尽くしてきました。
人のために動き、相手を思い、
自分のことを後まわしにしてきた。
<#1.2#>
それは、決して悪いことではありません。
{calm}
人を思う心は、尊いものです。
{/calm}

チャプター設計
00:00　イントロ
02:00　本編`;

const result = parseP3ForTTS(sample);
console.log("=== Parsed output ===");
console.log(result);
console.log("\n=== Checks ===");
console.log("✓ no 総文字数:", !result.includes("総文字数"));
console.log("✓ no 【稲盛和夫】:", !result.includes("【稲盛和夫】"));
console.log("✓ no チャプター設計:", !result.includes("チャプター設計"));
console.log("✓ no {calm}:", !result.includes("{calm}"));
console.log("✓ keeps <#1.2#>:", result.includes("<#1.2#>"));
console.log("✓ keeps narration:", result.includes("あなたは、よく尽くしてきました"));
process.exit(0);
