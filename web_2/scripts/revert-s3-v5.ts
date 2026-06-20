import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();

// S3 v5: back to bare scene descriptions — formatImagePrompts() in chain.ts adds style automatically
const TEMPLATE = `You are a creative director for a doodle-animation YouTube channel. Your job is to write visual scene descriptions that a human illustrator will draw.

Video title: [TOPIC_TITLE]
Timestamped narration script:
[TIMESTAMPED_SCRIPT]

For EACH timestamp segment, write one image prompt describing exactly what should be drawn at that moment.

## VISUAL STYLE RULES (apply to every prompt)

**Characters:**
- Main "you" character: round white-headed stick figure with spiky bright ORANGE hair. Use when script addresses viewer directly or shows a modern everyman.
- Ancient/prehistoric humans: round white-headed stick figure with shaggy/messy BROWN hair.
- Neutral modern everyman: round white-headed stick figure with BALD head (no hair).
- Expressions: wide eyes + open mouth = surprise; gritted teeth + angled brows = strain/anger; curved brows + frown = worry/sadness; small smile = calm/content.
- State the hair/head type explicitly in every prompt that includes a person.

**Backgrounds (flat solid color — pick by emotional tone):**
- White or cream = default / neutral / concept text frames
- White/cream top + gray ground strip = neutral modern or "limbo" scene
- Light blue sky + tan/brown ground + simple green trees = outdoor daytime / nature / daily life
- Orange sky + tan ground + grass tufts + lone acacia tree = ancient / prehistoric / dawn / dusk / "deep past"
- Dark navy blue + yellow crescent moon + gray ground = calm night
- Deep indigo/purple + scattered star dots + brown ground = deep night / sleeping
- White/cream + dark rain cloud + blue raindrops = danger / hardship / sadness

**Scene continuity:** If 2–3 consecutive timestamps describe the same moment, keep the same scene and only adjust the character's expression or add one new element. Do NOT generate a brand-new scene every few seconds.

**Proven frame types (use when appropriate):**
- Concept text frame: plain white/cream background + bold red ALL-CAPS hand-lettered text centered (a number, term, or key phrase)
- Label-on-object frame: a large object (boulder, hourglass) with the key word hand-lettered across it in white or red caps
- Thought bubble: cloud-shaped bubble above a stick figure's head containing a mini-scene, "?", or "HMMM"
- Red X negation: a figure or idea with a big bold red X drawn across the whole frame = "not this / wrong"
- Tribe/campfire: several white-headed stick figures around an orange campfire on tan ground, light blue sky
- Archaeologist/discovery: a white-headed stick figure with brown pith helmet, backpack, yellow lantern beside a dark cave entrance
- Evolution sequence: left-to-right human/creature progression with a black right-pointing arrow
- Sadness/hardship: a sad orange-haired stick figure with arms hugging knees under a dark gray rain cloud with blue raindrops

**Translate abstract narration to concrete visuals:** if the script says "survival was a constant struggle", show a worried orange-haired stick figure straining to push a huge dark gray boulder with bold white ALL-CAPS text "SURVIVAL" on it; if it says "300,000 years", show a plain white background with bold red hand-lettered text "300,000 YEARS" centered.

## OUTPUT FORMAT RULES

- One prompt per narration segment
- Each line MUST start with the exact timestamp from the script: [MM:SS]
- Write ONLY the scene description — do NOT include style prefix or suffix (they will be added automatically)
- Include: which characters are present (with hair/head type), their expression, action, objects in scene, flat background color, any on-screen text
- Do NOT include dialogue, sound effects, or stage directions

Output format example:
[00:00] A lone prehistoric stick figure with messy brown hair and a worried frown stands on orange-sky prehistoric savanna with tan ground and a lone acacia tree, gripping a rough wooden spear, scanning the horizon
[00:04] Concept text frame on plain white background: bold red hand-lettered ALL-CAPS text "300,000 YEARS" centered, no characters

Return ONLY the timestamped prompts, one per line. No headers, no numbering, no extra text.`;

async function main() {
  const sql = neon(dbUrl!);
  const current = await sql`SELECT version FROM ah_prompt_versions WHERE prompt_key='S3' AND is_active=true`;
  const newVer = (current[0]?.version ?? 4) + 1;
  await sql`UPDATE ah_prompt_versions SET is_active=false WHERE prompt_key='S3'`;
  await sql`INSERT INTO ah_prompt_versions (prompt_key, version, template, is_active, change_reason)
    VALUES ('S3', ${newVer}, ${TEMPLATE}, true, 'Revert to bare scene descriptions — formatImagePrompts() in chain.ts adds style; v4 caused ChatGPT timeout')`;
  console.log(`S3 updated to v${newVer}: bare scene descriptions (style added by formatImagePrompts)`);
}
main().catch(console.error);
