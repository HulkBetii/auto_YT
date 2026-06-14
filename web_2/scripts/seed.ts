// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

// Dynamic imports happen after dotenv populates process.env
async function main() {
  const { insertAhPromptVersion } = await import("../lib/db/repo/prompt-versions");
  const { setAhConfigValue } = await import("../lib/db/repo/channel-config");

  const S1_TEMPLATE = `You are a creative director for an English-language YouTube channel about ancient humans and prehistoric civilisations.

Generate EXACTLY 5 distinct video topic ideas. Each topic must be:
- Educational yet entertaining (hook-first storytelling)
- Specific enough to cover in a 6-10 minute doodle-animation video
- About real events, discoveries, or behaviours of early/ancient humans
- Optimised for YouTube trending (surprising angle, strong hook, curiosity gap)

Return a JSON array with exactly 5 objects. Each object must have these fields:
- title: the YouTube video title (max 70 chars, hook-first)
- angle: the surprising or contrarian angle that makes this unique
- hook: the opening 2-sentence hook for the narration
- viral_type: one of [shocking_fact, mystery, vs_comparison, first_discovery, survival_story]
- key_questions: array of 3 questions the video will answer

Example structure (do NOT copy this content):
[
  {
    "title": "The First Human Who Cooked Food Changed Everything",
    "angle": "Cooking didn't just feed us — it literally made our brains bigger",
    "hook": "1.8 million years ago, one human did something no animal had ever done. Within a few generations, their descendants had brains 30% larger than their ancestors.",
    "viral_type": "shocking_fact",
    "key_questions": ["Why did cooking change human evolution?", "Which came first — fire control or big brains?", "How did Homo erectus actually cook?"]
  }
]

IMPORTANT: Return ONLY the JSON array. No markdown fences, no commentary.`;

  const S2_TEMPLATE = `You are a professional YouTube scriptwriter specialising in doodle-animation educational videos about ancient humans.

Write the full narration script for a video titled: [TOPIC_TITLE]
Angle: [TOPIC_ANGLE]
Opening hook: [HOOK]
Questions to answer: [KEY_QUESTIONS]

Script requirements:
- Length: 1,500–2,400 words (approximately 8–13 minutes narration at 175 wpm)
- Tone: curious, conversational, wonder-filled — as if a smart friend is explaining this
- Structure: Hook → Scene-setting → Main narrative (3-4 beats) → Surprising twist or revelation → Takeaway
- No chapter headers or section labels in the output — pure narration only
- Vary sentence length. Short punchy sentences for impact. Longer sentences to build context and flow.
- Use vivid sensory details and specific numbers/dates where possible
- End with a thought-provoking question or insight that invites comments

Return ONLY the script text. No title, no headers, no timestamps, no notes.`;

  const S3_TEMPLATE = `You are a creative director for a doodle-animation YouTube channel. Your job is to write visual scene descriptions that a human illustrator will draw.

Video title: [TOPIC_TITLE]
Timestamped narration script:
[TIMESTAMPED_SCRIPT]

For EACH timestamp segment, write one image prompt describing exactly what should be drawn for that moment in the animation.

Image prompt rules:
- One prompt per narration segment (match the timestamps)
- Each prompt: 1-3 sentences, present tense, scene-first
- Style: black-and-white doodle animation, hand-drawn sketch style, clean lines, minimal shading
- Include: what is shown, action happening, camera angle if important
- Do NOT include timestamps or numbering in the prompts
- Do NOT include dialogue, text overlays, or sound effects

Return ONLY the image prompts, one per line, in the same order as the timestamps. No timestamps, no numbers, no headers.`;

  const S4_TEMPLATE = `You are a YouTube SEO expert for an educational doodle-animation channel about ancient humans and prehistoric life.

Video topic: [TOPIC_TITLE]
Script excerpt: [SCRIPT_EXCERPT]

Generate YouTube metadata optimised for discovery and click-through.

Return a JSON object with exactly these fields:
{
  "title": "YouTube video title (50-70 chars, hook-first, curiosity-gap)",
  "description": "YouTube description (150-200 words). First 2 sentences as standalone hook. Then 3-4 sentences expanding the topic. Then 'In this video:' followed by 4-5 bullet points. End with a subscribe CTA. No hashtags in description body.",
  "tags": "comma-separated tags string, 15-20 tags, mix of broad and specific, no quotes"
}

Return ONLY the JSON object. No markdown fences, no commentary.`;

  console.log("Seeding prompt versions...");

  await insertAhPromptVersion({ promptKey: "S1", template: S1_TEMPLATE, changeReason: "initial seed" });
  console.log("  ✓ S1 prompt");

  await insertAhPromptVersion({ promptKey: "S2", template: S2_TEMPLATE, changeReason: "initial seed" });
  console.log("  ✓ S2 prompt");

  await insertAhPromptVersion({ promptKey: "S3", template: S3_TEMPLATE, changeReason: "initial seed" });
  console.log("  ✓ S3 prompt");

  await insertAhPromptVersion({ promptKey: "S4", template: S4_TEMPLATE, changeReason: "initial seed" });
  console.log("  ✓ S4 prompt");

  console.log("\nSeeding channel config defaults...");
  await setAhConfigValue("voice_id", "");
  await setAhConfigValue("web2_url", process.env.WEB2_URL ?? "http://localhost:3001");
  await setAhConfigValue("openai_model", "gpt-4o-mini");
  console.log("  ✓ channel_config defaults");

  console.log("\nSeed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
