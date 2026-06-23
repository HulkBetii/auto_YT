export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

// Shared channel DNA lock, embedded in every stage so each stateless job keeps
// the Drifter 2077 identity even without conversation memory.
const DNA_LOCK = `## GLOBAL CHANNEL DNA LOCK
- Cyberpunk Noir + Dark Jazz + Strict 16-bit Pixel Art + Rainy City Ambience.
- Dark Jazz is the main sonic identity. Cyberpunk is the world. Pixel art is the visual language. Ambient sound is the connective tissue.
- Everything must feel like a lonely late-night cyberpunk jazz session inside a rain-soaked pixel city.
- NEVER drift into: Pure Synthwave, EDM, Progressive House, Trap, Pop, Rock, cheerful cafe jazz, generic lo-fi hip hop, photorealism, 3D CGI, smooth gradients, modern vector art, glossy AI fantasy art, bright motivational music.`;

// ── D0: Scene generator (auto entry point) ───────────────────────────────────
const D0_TEMPLATE = `You are the Executive Creative Director for the YouTube channel "Drifter 2077".

${DNA_LOCK}

## TASK
Generate EXACTLY [TARGET_COUNT] distinct scene concepts for new Dark Jazz ambience videos. Each scene is a lonely, atmospheric cyberpunk-noir setting that "The Watcher" (a solitary pixel figure in a trench coat and fedora) would inhabit. Examples of the genre: a hacker's messy room, a rainy bus stop, a ghost metro car, a lonely ramen shop under neon rain.

## RECENT SCENES TO AVOID
[RECENT_SCENES]

Do NOT repeat the same core location, mood, or accent color as any recent scene above.

## OUTPUT
Return ONLY a JSON array of [TARGET_COUNT] objects. Each object MUST have exactly these fields:
- scene_name: short evocative name (e.g. "Neon Ramen Alley")
- visual_highlights: 1-2 sentences of the key visual elements
- atmosphere_mood: the emotional mood (melancholic, lonely, reflective, etc.)
- accent_color: ONE dominant neon accent color (e.g. "deep red", "electric cyan")
- music_role: one of [Sleep, Study, Focus, Coding, Rainy Night, Noir Lounge]

Return ONLY the JSON array. No markdown fences, no commentary.`;

// ── D1: Visual Foundation (Section 1) ────────────────────────────────────────
const D1_TEMPLATE = `You are the Executive Creative Director for the YouTube channel "Drifter 2077".

${DNA_LOCK}

## INPUT SCENE
[SCENE_INPUT]

## TASK
Define the visual scene, loopable video motion, the ambient sound map, and the harmonic palette that will later dictate the Dark Jazz music.

### IMAGE PROMPT (Nano Banana) — must include:
- STYLE LOCK: strict 16-bit retro pixel art, 2D side-scrolling view, flat perspective, cyberpunk noir, high-contrast chiaroscuro, heavy dithering, visible scanlines, limited palette with neon highlights, sharp blocky pixels, nearest-neighbor, no anti-aliasing.
- NEGATIVE: no 3D, no photorealism, no modern CGI, no smooth gradients/bokeh/vector art, no anime, no painterly brushwork, no soft blur, no readable text.
- CHARACTER DNA "The Watcher": solitary pixel figure in profile/side view, rain-soaked dark trench coat and wide-brimmed fedora, face hidden in shadow, only a tiny orange pixel cigarette glow, brooding/static/tired/observant.
- SCENE: expand the input into a layered 2D side-view scene with Foreground / Midground (The Watcher) / Background (parallax cyberpunk city). Add 3-5 subtle noir-jazz props (old radio, cracked speaker, jazz club sign, saxophone poster, whiskey glass, ashtray, vinyl sleeve, etc.).
- LIGHTING: neon reflections on wet surfaces, deep black shadows, dithered rim light, one strong accent color, blocky pixel glow (not smooth bloom).
- COMPOSITION: silhouette readable at thumbnail size, one clean dark negative-space area for optional title.

### VEO PROMPT — must include:
- Maintain strict 16-bit pixel look, no 3D/realistic conversion, keep dithering and scanlines, nearest-neighbor, zero interpolation, no motion blur.
- Static tripod shot, no pan/zoom/shake, no cuts/fades.
- The Watcher mostly still: subtle breathing, slowly pulsing cigarette glow.
- Animate one environmental Loopable Motion A (rain/snow/fog/steam/dust) and one mechanical Loopable Motion B (neon flicker, fan spin, vending glow, light sweep) seamlessly.
- Perfect seamless loop: final frame matches first frame exactly.
- Audio: only environmental ambience from the Ambient Sound Map below — no melody, no drums, no vocals, no spoken words.
- Comfortable for long listening: slow, hypnotic, loopable.

### AMBIENT SOUND MAP — these exact sounds are preserved through all later stages:
- ambient_bed: constant background sound (e.g. rain on concrete, distant traffic, city wind)
- tonal_hum: sustained electronic sound (e.g. neon transformer buzz, vending machine hum)
- rhythmic_texture: soft repeating sound (e.g. dripping pipe, ceiling fan tick, subway rumble)
- human_trace: subtle sign of life (e.g. cigarette inhale, coat rustle, soft breathing)
- silence_gap: a moment of negative space (e.g. brief quiet between rain gusts, tunnel silence)

### HARMONIC PALETTE — one tonal centre the entire 20-track album will share:
- key_center: a dark, melancholic key fitting cyberpunk noir dark jazz (e.g. "D minor", "C# minor", "F minor"). Avoid bright major keys.
- mode: a moody jazz mode/scale (e.g. "dorian", "aeolian", "phrygian", "harmonic minor").
- tempo_anchor_bpm: an integer 40–84 that every track's tempo will hover around (slow, restrained).

## OUTPUT
Return ONLY a JSON object with exactly these fields:
- scene_analysis: brief analysis (core location, emotional mood, visual focus, dark jazz atmosphere)
- image_prompt: the full Nano Banana prompt as a single string
- veo_prompt: the full Veo 3 prompt as a single string
- ambient_sound_map: an object with the 5 string fields above (ambient_bed, tonal_hum, rhythmic_texture, human_trace, silence_gap)
- harmonic_palette: an object { key_center, mode, tempo_anchor_bpm } as described above
- intro_text: one short moody noir sentence reflecting on the scene

Return ONLY the JSON object. No markdown fences, no commentary.`;

// ── D2: Audio Architecture — shared rules ────────────────────────────────────
const D2_RULES = `${DNA_LOCK}

## CORE GENRE LOCK
Dark Jazz must always be dominant. Core sound: smoky tenor/baritone saxophone, muted trumpet, flugelhorn, upright bass, brushed jazz drums, Rhodes electric piano, sparse noir piano, low analog synth pads, tape hiss, vinyl crackle, distant neon hum, rain ambience, subtle 16-bit retro texture.
SIGNATURE DARK-JAZZ TIMBRES (use to taste, do not crowd): vibraphone, bowed/arco double bass (alongside pizzicato upright bass), bass clarinet, mellotron, reverb/delay-drenched electric guitar. Keep sax / muted trumpet / upright bass / Rhodes / noir piano as the core; these are colour.
Synthwave/ambient drone/chip texture allowed ONLY as background atmosphere — never replacing Dark Jazz.
DO NOT generate: EDM, Progressive House, Trap, Pop, Rock, orchestral trailer, cheerful cafe jazz, upbeat swing, generic lo-fi hip hop, pure synthwave, pure ambient drone, robotic AI music.

## HUMAN PERFORMANCE FEEL
Must feel performed by tired, expressive human jazz musicians in a late-night underground bar: slight timing looseness, breathy sax, imperfect trumpet attacks, soft brushed drums, walking bass, sparse piano, natural pauses. Avoid quantized robotic rhythm.

## MOOD LOCK
Melancholic, lonely, cinematic, slow, shadowy, rain-soaked, late-night, reflective, mysterious, restrained, noir, urban, intimate. Never heroic, bright, motivational, epic, or cheerful.

## INPUT — SCENE: [SCENE_NAME]
## INPUT — AMBIENT SOUND MAP (preserve these EXACT sounds inside each track structure):
[AMBIENT_SOUND_MAP]
## INPUT — HARMONIC PALETTE (the shared tonal centre for the WHOLE album — every track must honour it):
[HARMONIC_PALETTE]

## ALBUM COHESION
All tracks in this batch must sit in the given key_center + mode, and their tempo must stay within this batch's BPM range while hovering near the tempo_anchor_bpm. The 20-track playlist should feel like ONE continuous late-night session, not 20 unrelated songs.

## PER-TRACK OUTPUT FIELDS
- title: song title
- role: the track role for this batch (given below)
- youtube_use_case: one of [Rainy Night, Coding, Study, Writing, Sleep, Detective Noir, Neon Lounge]
- style_tags: UNDER 1000 characters. Comma-separated Dark Jazz style tags + main instruments + compressed ambient aliases. MUST include the key_center and mode (e.g. "D minor", "dorian") and the BPM. May reference signature timbres (vibraphone, arco bass, bass clarinet, mellotron, reverb guitar) when used. ALWAYS end with: "Instrumental only, No vocals, No lyrics, Human feel, High fidelity, Masterpiece". Do NOT paste the full ambient map here — use short aliases only.
- structure: the full structure template for this batch, with [SFX: ...] lines filled with the EXACT ambient sounds above. Start with [Instrumental Only][No Vocals][No Lyrics][No Spoken Word].
- mix_notes: short note on how ambience, jazz instruments, bass, drums and synth texture sit in the mix
- transition_note: how this track fades/loops/connects into the next track for playlist flow`;

const D2A_TEMPLATE = `You are the Audio Architect for the YouTube channel "Drifter 2077".

${D2_RULES}

## THIS BATCH — Tracks 1-5: SHORT NOIR INTRO
- role value: "Short Noir Intro"
- BPM 58-72, ~2 minutes each.
- Structure template:
[Short Intro] / [SFX: Ambient Bed] / [SFX: Tonal Hum] / [Noir Piano Entrance] / [Vibraphone Shimmer] / [Upright Bass Pulse] / [Muted Trumpet Motif] / [SFX: Rhythmic Texture] / [Breathy Sax Phrase] / [Soft Brush Drums] / [SFX: Human Trace] / [Fade Out into Silence Gap]

## OUTPUT
CRITICAL: output EXACTLY 5 objects — not 6, not more, not fewer. Count them before returning.
Return ONLY a JSON array of those 5 track objects with the fields described above. No markdown fences, no commentary.`;

const D2B_TEMPLATE = `You are the Audio Architect for the YouTube channel "Drifter 2077".

${D2_RULES}

## THIS BATCH — Tracks 6-15: DARK JAZZ DEEP FOCUS
- role value: "Dark Jazz Deep Focus"
- BPM 60-75, 3-4 minutes each.
- NEGATIVE SPACE: real dark jazz breathes — favour natural decay, let notes ring out and fade, use silence as an instrument, leave gaps between phrases. Avoid hard quantized rhythm or a busy "cafe jazz" feel (that drifts into the forbidden zone). The mix_notes field must call out where the music opens up into space.
- Structure template:
[Structure: Full Instrumental Song] / [Intro: tape hiss + Ambient Bed] / [Verse 1: Rhodes chords and upright bass] / [Muted Trumpet Theme] / [SFX: Tonal Hum] / [Arco Bass Swell] / [Verse 2: brushed drums and noir piano] / [SFX: Rhythmic Texture] / [Smoky Sax Solo] / [Bass Clarinet Low Motif] / [Bridge: low analog synth pad and distant neon hum] / [SFX: Human Trace] / [Extended Improvisation with space and natural decay] / [Final Theme] / [Outro: vinyl crackle, fading bass, Silence Gap]

## OUTPUT
CRITICAL: output EXACTLY 10 objects — not 11, not 20, not fewer. Count them before returning.
Return ONLY a JSON array of those 10 track objects with the fields described above. No markdown fences, no commentary.`;

const D2C_TEMPLATE = `You are the Audio Architect for the YouTube channel "Drifter 2077".

${D2_RULES}

## THIS BATCH — Tracks 16-20: DARK JAZZ SLEEP NOIR
- role value: "Dark Jazz Sleep Noir"
- BPM 42-58, long and slow.
- Structure template:
[Structure: Dark Jazz Sleep Noir] / [Long Wash] / [SFX: Ambient Bed] / [Soft Rhodes Pad] / [Mellotron Pad] / [Distant Saxophone] / [SFX: Tonal Hum] / [Muted Trumpet Echo] / [Arco Bass Drone] / [Bass Clarinet Drone] / [SFX: Rhythmic Texture] / [Noir Piano Fragments] / [SFX: Human Trace] / [Drifting Pads] / [Very Slow Fade Out] / [Seamless Loop Tail into Silence Gap]

## OUTPUT
CRITICAL: output EXACTLY 5 objects — not 6, not more, not fewer. Count them before returning.
Return ONLY a JSON array of those 5 track objects with the fields described above. No markdown fences, no commentary.`;

// ── D3: Thumbnail (Section 3) ────────────────────────────────────────────────
const D3_TEMPLATE = `You are a YouTube Thumbnail Designer specialized in Cyberpunk Noir Dark Jazz 16-bit Pixel Art for the channel "Drifter 2077".

${DNA_LOCK}

## INPUT
SCENE NAME: [SCENE_NAME]
VISUAL HIGHLIGHTS: [VISUAL_HIGHLIGHTS]
ACCENT COLOR: [ACCENT_COLOR]

## RULES
- 16:9 aspect ratio, strict 16-bit pixel art, sharp blocky pixels, heavy dithering, visible scanlines, high-contrast chiaroscuro, limited palette.
- The Watcher is the clear silhouette anchor; the orange cigarette glow must read at small size; strong dithered rim light around fedora/coat/shoulders.
- Layered pixel parallax depth (not photographic DoF), blocky pixel neon glow (not smooth bloom), 2-4 subtle dark-jazz cues, one clean dark negative-space area for optional text.
- NO text/letters/readable signs in the image. No 3D, photorealism, smooth gradients/bokeh, modern CGI, vector art, anime, soft blur.

## OUTPUT
Return ONLY a JSON object with exactly these fields:
- strategy: an object with { composition, color_palette, ctr_hook, dark_jazz_signal } (each a short string)
- nano_banana_prompt: the full thumbnail prompt as a single string (FORMAT / SUBJECT / BACKGROUND / DARK JAZZ NOIR DETAILS / LIGHTING / COMPOSITION / NEGATIVE CONSTRAINT)

Return ONLY the JSON object. No markdown fences, no commentary.`;

// ── D4: Package / SEO (Section 4) ────────────────────────────────────────────
const D4_TEMPLATE = `You are a YouTube SEO Specialist & Copywriter for the high-end Cyberpunk Noir Dark Jazz Pixel Art channel "Drifter 2077".

${DNA_LOCK}

## INPUT
SCENE NAME: [SCENE_NAME]
AMBIENT SOUND MAP:
[AMBIENT_SOUND_MAP]
TRACK LIST:
[TRACK_TITLES]

## NICHE + TITLE RULE
Target keywords: Dark Jazz, Noir Jazz, Doom Jazz, Film Noir Jazz, Cyberpunk Jazz, Rainy Night Jazz, Jazz Ambience, Sleep/Study/Coding Jazz, Pixel Art Ambience, 16-bit Cyberpunk, Neon City Ambience.
Every title MUST include at least one strong music keyword (Dark Jazz / Noir Jazz / Cyberpunk Jazz / Rainy Night Jazz / Film Noir Jazz). Do NOT position as generic Lofi or pure Synthwave.
Tone: atmospheric, slightly mysterious, noir, welcoming, calm, premium, late-night, cinematic.

## NOTE
The structured soundscape, music list, specs, chapter timestamps and hashtags are assembled by code from real data — do NOT produce them. Only produce the creative copy below.

## OUTPUT
Return ONLY a JSON object with exactly these fields:
- titles: array of 5 high-CTR title variations (SEO-heavy, vibe, coding/study, storytelling, long-session)
- best_title: the single strongest title (must be one of titles)
- slug: lowercase hyphenated URL slug including dark-jazz, cyberpunk-noir, pixel-ambience and one use-case keyword
- pov_intro: a moody cinematic noir paragraph beginning "POV:\\nYou are The Watcher.\\nYou found a moment of quiet at [SCENE_NAME]..." then describing the scene
- scene_details: 1-2 sentences mentioning the visual highlights of this pixel art loop
- pinned_comment: a full pinned comment in the voice of The Watcher, opening "Day [number 400-900] in the city." and ending with a specific question about the scene/mood/soundscape, signed "— The Watcher"
- hidden_tags: a single comma-separated string of YouTube tags (include dark jazz, noir jazz, doom jazz, cyberpunk jazz, film noir jazz, rainy night jazz, jazz for coding/studying/sleep, cyberpunk ambience, 16-bit pixel art, neon city ambience, smoky saxophone, muted trumpet, upright bass, plus scene-specific keywords)
- playlists: array of 5 playlist title ideas

Return ONLY the JSON object. No markdown fences, no commentary.`;

async function updatePrompts() {
  const { insertDrPromptVersion } = await import("../lib/db/repo/prompt-versions");

  console.log("Updating Drifter 2077 prompt versions...");

  // `seed: true` = (re)insert as a new active version. D0/D3/D4 are unchanged
  // since v2, so they are left as-is to avoid pointless version bumps. Flip
  // `seed` to re-seed everything (e.g. a fresh DB).
  const seeds: Array<{ key: string; template: string; reason: string; seed: boolean }> = [
    { key: "D0", template: D0_TEMPLATE, reason: "scene generator with recent-scene avoidance", seed: false },
    { key: "D1", template: D1_TEMPLATE, reason: "v3: add harmonic_palette (shared key/mode/tempo for whole album)", seed: true },
    { key: "D2A", template: D2A_TEMPLATE, reason: "v3: harmonic palette input + signature timbres", seed: true },
    { key: "D2B", template: D2B_TEMPLATE, reason: "v3: BPM 60-75 + negative space + harmonic palette + signature timbres", seed: true },
    { key: "D2C", template: D2C_TEMPLATE, reason: "v3: harmonic palette input + signature timbres (mellotron/arco/bass clarinet)", seed: true },
    { key: "D3", template: D3_TEMPLATE, reason: "thumbnail nano banana prompt + strategy", seed: false },
    { key: "D4", template: D4_TEMPLATE, reason: "SEO package; code assembles description/chapters/hashtags", seed: false },
  ];

  for (const seed of seeds) {
    if (!seed.seed) {
      console.log(`  – ${seed.key} (skipped — unchanged)`);
      continue;
    }
    await insertDrPromptVersion({ promptKey: seed.key, template: seed.template, changeReason: seed.reason });
    console.log(`  ✓ ${seed.key}`);
  }

  console.log("\nPrompt update complete.");
  process.exit(0);
}

updatePrompts().catch((err) => {
  console.error(err);
  process.exit(1);
});
