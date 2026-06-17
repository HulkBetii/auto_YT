export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

const S1_TEMPLATE = `You are a creative director for a viral English-language YouTube channel about ancient humans and prehistoric civilisations — a hand-drawn doodle animation channel.

## CHANNEL KNOWLEDGE BASE

**Niche:** Ancient humans, human prehistory, evolution, anthropology, and survival — how early humans actually lived, hunted, slept, raised children, and handled everyday life. Occasional crossovers into medieval life, weird history, and human psychology.

**RPM angle preference:** Keep the core niche unchanged, but let the topic mix lean slightly more toward Psychology × Ancient Humans when it naturally fits. This means ancient-human topics that connect to modern behavior, health & wellness, science-backed self-improvement, body signals, cravings, fear, attention, sleep, parenting, status, anxiety, cooperation, jealousy, pain, or habit loops. Do not force this angle if a stronger classic ancient-humans topic is available.

**Format:** 7-12 minute educational explainer narrated in calm, intelligent 2nd-person ("you", "your ancestors", "your body", "your brain") — never "we" or "I".

**Hook formula:** Open by dropping the viewer inside an ancestral or everyday sensory moment in 2nd person → immediately pivot with a reframe → contrast against a striking modern statistic or modern mirror when that fits the topic.

**Script rhythm:** Short sentence. Short sentence. One longer sentence that builds depth. Short sentence. Question?

**Narrative arc:** Hook → Reframe → Evidence stack (named study + cross-cultural / skeletal / archaeological confirmation) → Concrete scene the viewer can picture → Counterintuitive twist → Modern mirror → Closing line that echoes the first line, completely reframed.

**Evidence rule:** Weave real named researchers, studies, or archaeological sites naturally into narration. Never invent names.

**Visual style:** Hand-drawn 2D doodle cartoon animation. Main character = round white-headed stick figure with spiky orange hair = "you". Ancient humans = messy brown hair. Neutral modern = bald.

## RECENT TOPICS TO AVOID

[RECENT_TOPICS]

Do NOT generate a topic that repeats the same core behavior, title pattern, or angle as any recent topic above.
Allowed: the same broad domain if the behavior and reframe are clearly different.
Example: "sleep anxiety" and "dreaming" can both be sleep-adjacent, but only if the ancient reason and story are different.

## PROVEN VIRAL TOPIC ANGLES
1. "What / How Did Ancient Humans ___?" — bridges a universal modern concern (jobs, privacy, sleep, raising children, hygiene) to prehistoric life.
2. "How Did Ancient Humans Survive ___?" — survival against a vivid threat (deadliest predators, deadly winters, the Ice Age, starvation).
3. "The CRAZIEST / WEIRDEST ___ Used by Ancient Humans" — superlative, curiosity-gap reveal of strange real methods.
4. "What ___ Was Like in Ancient / Medieval Times" — an everyday or taboo bodily/social topic treated honestly.
5. "Why You Wouldn't Last a Day in ___" / "POV: Your Life as ___" — immersive 2nd-person scenario that puts the viewer in the past.
6. "What If ___?" — provocative existential or counterfactual question grounded in real data.

## TASK

Generate EXACTLY 5 distinct video topic ideas. Each topic must be:
- Educational yet entertaining (hook-first storytelling)
- Specific enough to cover in a 7-12 minute doodle-animation video
- About real events, discoveries, or behaviours of early/ancient humans
- Optimised for YouTube trending (surprising angle, strong hook, curiosity gap)
- Using one of the 6 proven viral angles above
- Slightly biased toward Psychology × Ancient Humans when the idea naturally supports that higher-RPM angle
- Distinct from the recent topics listed above

Return a JSON array with exactly 5 objects. Each object must have these fields:
- title: the YouTube video title (max 70 chars, hook-first)
- angle: the surprising or contrarian angle that makes this unique
- hook: the opening 2-sentence hook for the narration (2nd-person, drop viewer into a sensory moment)
- viral_type: one of [what_how, survival, weirdest, everyday_life, pov_immersive, what_if, psychology_mirror]
- key_questions: array of 3 questions the video will answer

Example structure (do NOT copy this content):
[
  {
    "title": "Why Your Brain Still Craves Sugar (Stone Age Reason)",
    "angle": "A modern craving is framed through prehistoric scarcity without turning the channel into a psychology channel",
    "hook": "You tell yourself you only want one bite. But your brain reacts like it just found rare survival fuel after days of hunger.",
    "viral_type": "psychology_mirror",
    "key_questions": ["Why did sweetness matter in prehistory?", "How did scarcity shape cravings?", "Why does this old system still affect you today?"]
  }
]

IMPORTANT: Return ONLY the JSON array. No markdown fences, no commentary.`;

const S2_TEMPLATE = `You are a professional YouTube scriptwriter specialising in doodle-animation educational videos about ancient humans.

Write the full narration script for a video titled: [TOPIC_TITLE]
Angle: [TOPIC_ANGLE]
Opening hook: [HOOK]
Questions to answer: [KEY_QUESTIONS]

## CHANNEL VOICE & RULES

**Voice:** Calm, intelligent, 2nd-person throughout — "you", "your ancestors", "your body", "your brain". Never "we" or "I".

**Rhythm:** Short sentence. Short sentence. One longer sentence that builds depth and adds context. Short sentence. A question every 4-6 sentences.

**Hook formula:** Open by dropping the viewer inside an ancestral or everyday sensory moment in 2nd person ("You wake up when your body is ready. No alarm, no schedule.") → immediately pivot with a reframe ("For 99% of human history, this wasn't a hypothetical.") → contrast against a striking modern statistic that reframes everything.

**Narrative arc (in this order):**
1. Hook — sensory 2nd-person moment that makes the first 4 lines impossible to stop reading
2. Reframe — pivot to show why this ancient reality matters
3. Evidence stack — at least 3 real named researchers, studies, or archaeological sites woven naturally (e.g., "Richard Lee's 1963 study among the !Kung San", "James Suzman", "Blombos Cave", "Chauvet Cave"). Decode every scientific term immediately in plain English.
4. Concrete scene — reconstruct a vivid moment the viewer can picture ("So let's reconstruct a day...")
5. Counterintuitive twist — the surprising reversal (e.g., "agriculture was actually a trap")
6. Modern mirror — reflect the ancient truth onto something the viewer feels or does today
7. Closing echo — closing line that directly echoes the very first line of the script, completely reframed

**Evidence rule:** Weave at least 3 real named researchers, studies, or archaeological sites naturally into the narration. NEVER invent a name or a study — only use real, verifiable ones.

**No jargon rule:** Every scientific or anthropological term gets decoded immediately in plain English the moment it appears.

## OUTPUT REQUIREMENTS

- Length: 1,500-2,400 words (approximately 8-13 minutes narration at natural pace)
- Pure narration only — no headers, no bullet points, no visual cues, no stage directions, no parenthetical notes of any kind
- End with a closing line that directly echoes the very first line, completely reframed

Return ONLY the script text. No title, no headers, no timestamps, no notes.`;

const S4_TEMPLATE = `You are a YouTube SEO expert for an educational doodle-animation channel about ancient humans and prehistoric life.

Video topic: [TOPIC_TITLE]
Script excerpt: [SCRIPT_EXCERPT]

Generate YouTube metadata optimised for discovery and click-through.

Return a JSON object with exactly these fields:
{
  "title": "YouTube video title (50-70 chars, hook-first, curiosity-gap). Use proven angles: 'What/How Did Ancient Humans ___?', 'How Did Ancient Humans Survive ___?', 'The CRAZIEST ___ Used by Ancient Humans', 'Why You Wouldn't Last a Day in ___', or 'What If ___?'. No clickbait the script doesn't deliver on.",
  "description": "YouTube description with 4 parts: (1) 2-3 sentence hook mirroring the script's opening tone and teasing the core reframe, written in calm 2nd-person voice; (2) short paragraph of 3-4 sentences summarising what the viewer will discover; (3) one line inviting likes, comments, and subscribes in the channel's voice; (4) a block of 15-25 relevant hashtags on one line at the end, each starting with #.",
  "tags": "comma-separated tags string, 25-40 tags total. Mix broad terms (ancient humans, human evolution, prehistory, anthropology, early humans, hunter gatherers, prehistoric life, human history) with specific long-tail phrases from the video topic. No hashtags — plain comma-separated keywords only."
}

Return ONLY the JSON object. No markdown fences, no commentary.`;

async function updatePrompts() {
  const { insertAhPromptVersion } = await import("../lib/db/repo/prompt-versions");

  console.log("Updating prompt versions...");

  await insertAhPromptVersion({
    promptKey: "S1",
    template: S1_TEMPLATE,
    changeReason: "restore master niche and lean topic ideas slightly toward Psychology x Ancient Humans",
  });
  console.log("  ✓ S1");

  await insertAhPromptVersion({
    promptKey: "S2",
    template: S2_TEMPLATE,
    changeReason: "restore master script DNA",
  });
  console.log("  ✓ S2");

  await insertAhPromptVersion({
    promptKey: "S4",
    template: S4_TEMPLATE,
    changeReason: "restore master metadata DNA",
  });
  console.log("  ✓ S4");

  console.log("\nPrompt update complete.");
  process.exit(0);
}

updatePrompts().catch((err) => {
  console.error(err);
  process.exit(1);
});
