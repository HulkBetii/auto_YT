# Drifter 2077 — Current Tool Prompts

> For a Claude session working on `web_3/`. Describes every active pipeline prompt
> and **exactly which code consumes/supports it**. Channel: **Drifter 2077** —
> Cyberpunk Noir Dark Jazz 16-bit pixel ambience (long-form YouTube music videos).

Generated: 2026-06-23. Source of truth: active rows in `dr_prompt_versions`
(seeded by `scripts/update-prompts.ts`; editable live via the Prompts dashboard →
`app/api/prompts/route.ts`). Active versions: **D1, D2A, D2B, D2C = v3**; D0, D3, D4 = v2.

> **Audio update (v3) changelog** — six changes to make the 20-track playlist feel
> like one album and reduce "inauthentic/reused" risk:
> 1. **Harmonic palette** carried D1→D2 (shared key/mode/tempo) — `dr_episodes.harmonic_palette`.
> 2. **D2B tempo** 68-84 → **60-75 BPM** + negative-space guidance.
> 3. **Signature dark-jazz timbres** added to D2 (vibraphone, arco bass, bass clarinet, mellotron, reverb guitar).
> 4. **Primary clip selection** — code picks ONE best-fit clip/track (`primaryClipIndex`), no longer keeps all.
> 5. **Ambient bed** — a dedicated per-episode Suno ambience track (`dr_episodes.ambient_bed_audio`) looped under the mix by `scripts/assemble_audio.py` (crossfade + loudnorm).
> 6. **Crossfade-aware chapters** — `buildChaptersFromAudio(audio, crossfadeSec)` subtracts overlap so timestamps match the assembled audio.
> Rollback: `tsx scripts/_rollback-prompts.ts` (D1/D2 → v2).

---

## 1. Pipeline shape

```
D0 scene-gen → D1 visual+ambient → D2A(1-5) → D2B(6-15) → D2C(16-20) → SUNO fan-out → D3 thumbnail → D4 package → ready → [local: image+Veo+assembly]
   (auto only)    (per-episode ChatGPT conversation, D1..D4 share one chat)
```

- Product = **one looping pixel-art video + a long instrumental Dark Jazz playlist** (no narration/TTS).
- Each ChatGPT stage returns **strict JSON**; the chain parses it and advances. Code: `lib/pipeline/chain.ts` (`runDrChainCycle`, `STAGE_HANDLERS`).
- The decomposition is **stateless**: every stage re-injects the context it needs via `[PLACEHOLDER]` tokens (`lib/utils/template.ts:interpolate`), so a stage works even without conversation memory. The worker *additionally* keeps D1–D4 in one ChatGPT conversation for creative coherence (see §3).

## 2. Code-supported behavior (what is NOT left to the LLM)

- **Prompt versioning:** active templates load from `dr_prompt_versions`; saving inserts a new version and deactivates the old one. Code: `lib/db/repo/prompt-versions.ts`, `scripts/update-prompts.ts`, `app/api/prompts/route.ts`.
- **Idempotency:** `enqueueDrStage({ causedByJobId })` skips creating a duplicate downstream job when a cron re-runs a crashed handler. Code: `lib/pipeline/createJob.ts`, `lib/db/repo/jobs.ts:findDrJobByCause`.
- **Scene origin:** auto episodes start at D0; **manual** episodes skip D0 — the dashboard posts a 5-field scene and the episode starts at D1. Code: `app/api/videos/create/route.ts`, `lib/pipeline/format.ts:parseSceneInput`.
- **Ambient Sound Map carry-forward:** D1's `ambient_sound_map` is stored on `dr_episodes.ambient_sound_map` and re-injected verbatim into D2A/B/C and D4 via `[AMBIENT_SOUND_MAP]`. Code: `lib/pipeline/format.ts:formatAmbientSoundMap`, `chain.ts`.
- **Harmonic Palette carry-forward (v3):** D1 also outputs `harmonic_palette {key_center, mode, tempo_anchor_bpm}`, validated (`format.ts:parseHarmonicPalette`, tempo 40–84) and stored on `dr_episodes.harmonic_palette`, then re-injected into D2A/B/C via `[HARMONIC_PALETTE]` so every track shares one tonal centre. Code: `format.ts:formatHarmonicPalette`, `chain.ts`.
- **D2 batch size is hard-capped in code:** even if the LLM over-produces, `parseTrackSpecs` truncates each batch to exactly 5 / 10 / 5. Code: `lib/pipeline/chain.ts:parseTrackSpecs`.
- **Suno music generation (replaces TTS):** after D2C, code initializes one `audio[]` entry per spec and fans them out to AI33.PRO Suno. Code: `lib/pipeline/suno.ts`.
  - POST `https://api.ai33.pro/v1s/task/music-generation` (custom mode), poll GET `/v1/task/{id}`, header `xi-api-key: $SUNO_API_KEY`.
  - **Primary clip selection (v3):** all returned clips are stored, but code sets `primaryClipIndex` to the clip whose duration best fits the role window (Short Noir 90–180s, Deep Focus 180–300s, Sleep Noir 300–600s), dropping clips under `min_clip_sec`. Only the primary goes into the final video + chapters. Override-able from the dashboard (`POST /api/videos/[id]/tracks/[idx]/primary`). Field path: `metadata.suno_result.clips[].audio_url` / `.duration` (fallback `metadata.all_audio_urls`).
  - **Ambient bed (v3):** after D2C, code also queues ONE dedicated ambience track (`specIndex = -1`, stored in `dr_episodes.ambient_bed_audio`) with a Suno spec code-built from the ambient map (`suno.ts:buildAmbientBedSpec`). The same runner drives it; finalize → D3 only when the 20 tracks AND the bed are done. The assembler loops it under the mix.
  - **Concurrency cap:** AI33.PRO allows ≤10 queued tasks; code keeps in-flight ≤ `MAX_IN_FLIGHT=8` and treats HTTP 429/5xx/network on submit+poll as **transient** (retry next cycle), never a hard failure.
  - **Lease lock** `dr_episodes.suno_lock` ensures only one cron cycle drives the fan-out (avoids duplicate credit spend).
  - **Pause switch:** `dr_channel_config.suno_paused = "true"` holds the fan-out so you can run D0→D2 cheaply without generating audio.
  - File names for the local assembler: `dr_e{id}_t{NN}_{clipIdx}_{ddmmyyyy}_{hhmmss}.mp3`.
- **D4 is mostly code-assembled:** D4 returns only creative copy. Code builds the final description, the **soundscape block (from the real ambient map)**, the fixed music/specs blocks, the **hashtags**, and the **chapters** — one per track using its **primary clip**, with timestamps that **subtract crossfade overlap** (`crossfade_sec`) so they match the assembled audio. Code: `lib/pipeline/descriptionBuilder.ts` (`parseD4Variable`, `flattenClips`, `buildChaptersFromAudio(audio, crossfadeSec)`, `buildDescription`), `lib/config/channel.ts`.
- **Audio assembler (v3, deferred-local):** `scripts/assemble_audio.py` (Python + ffmpeg) reads the episode from Neon, crossfades the primary clips (`acrossfade`), loops the ambient bed underneath (`amix`, ~−18 dB), and `loudnorm`s the result. Spec: `docs/assemble_audio.md`.
- **Thumbnail / image / Veo loop are NOT auto-generated** — D1/D3 only emit prompts. Rendering + video muxing is the deferred local pipeline. Code stub: `lib/manual-image-project.ts` (`dr_e{id}` project folders).
- **Failure handling:** a handler/worker failure marks the episode `needs_attention` and alerts Telegram (`🌃 [Drifter 2077]`). Retry from the dashboard re-enqueues the failed job or resumes from the visual stage. Code: `chain.ts`, `app/api/videos/[id]/retry/route.ts`, `app/api/jobs/[id]/retry/route.ts`.

## 3. Worker wiring (`src/auto_yt/`)

- Polls `dr_jobs` after `jobs` and `ah_jobs`; routing key `("dr", episode_id)`. Code: `worker.py:get_page_for`, `job_queue.py:claim_next_dr_job`.
- **D0** runs in a shared "scene reservoir" tab (`dr_topic_page`).
- **D1–D4 share ONE ChatGPT conversation per episode.** The conversation URL is persisted in `dr_channel_config` key `dr_conversation_url:{id}` and restored on the next stage, so continuity survives a tab loss / worker restart. Code: `worker.py:_get_dr_episode_page`, `save_dr_conversation_url`, `process_dr_job`.
- After each job the worker fires the callback in job metadata (`web3_url` config, falling back to `WEB3_URL`, plus `/api/cron/process-jobs`) to advance the chain immediately; GitHub Actions cron (`*/5`) is the backstop.

## 4. Config keys (`dr_channel_config`)

| Key | Meaning |
|-----|---------|
| `target_scene_count` | how many scenes D0 generates before picking one (default 5) |
| `suno_model_version` | AI33.PRO Suno `major_model_version` (default `v4.5-all`) |
| `suno_paused` | `"true"` holds the Suno fan-out (run D0→D2 without spending credits) |
| `min_clip_sec` | drop Suno clips shorter than this during primary selection (default 60) |
| `crossfade_sec` | crossfade length used by BOTH chapters and the assembler (default 3) |
| `pipeline_paused` | `"true"` halts the whole chain |
| `worker_last_seen` / `cron_last_run_at` | heartbeats shown on the dashboard |

---

## 5. Active prompts (verbatim)

Each prompt also embeds a shared `## GLOBAL CHANNEL DNA LOCK` block (Cyberpunk Noir +
Dark Jazz + strict 16-bit pixel art; never drift into EDM/synthwave/photorealism/etc.).
Full text lives in `scripts/update-prompts.ts`; summaries + contracts below.

### D0 — Scene generator (v2)
- **When:** auto episodes only (`status d0_pending`).
- **In:** `[RECENT_SCENES]` (recent scene names to avoid), `[TARGET_COUNT]`.
- **Out:** JSON array of scene objects, each: `scene_name, visual_highlights, atmosphere_mood, accent_color, music_role` (one of Sleep/Study/Focus/Coding/Rainy Night/Noir Lounge).
- **Code:** `handleD0Done` stores `sceneInput = scenes[0]`, enqueues D1. Recent scenes from `listRecentSceneSummaries`.

### D1 — Visual Foundation (v3) = master-prompt Section 1
- **In:** `[SCENE_INPUT]` (5-field block; from D0 or manual entry, formatted by `formatSceneInput`).
- **Out:** JSON `{ scene_analysis, image_prompt, veo_prompt, ambient_sound_map:{ambient_bed,tonal_hum,rhythmic_texture,human_trace,silence_gap}, harmonic_palette:{key_center,mode,tempo_anchor_bpm}, intro_text }`.
- **Code:** `handleD1Done` validates the 5 ambient fields (`validateAmbient`) + the harmonic palette (`parseHarmonicPalette`, tempo 40–84), stores `visualFoundation` + `ambientSoundMap` + `harmonicPalette`, enqueues D2A with `[HARMONIC_PALETTE]`. `image_prompt` carries the full Nano Banana style lock + "The Watcher" character DNA; secondary NPCs must be non-human robots/androids/machines that fit the scene; `veo_prompt` the seamless-loop spec.

### D2A / D2B / D2C — Audio Architecture (v3) = Section 2 batches
- **In:** `[AMBIENT_SOUND_MAP]`, `[HARMONIC_PALETTE]`, `[SCENE_NAME]`.
- **Out:** JSON array of track objects — **exactly 5 / 10 / 5** (`CRITICAL: output EXACTLY N … Count them`). Each: `title, role, youtube_use_case, style_tags (<1000 chars, MUST include the key_center + mode + BPM, ends "Instrumental only, No vocals, …"), structure (with [SFX:] lines filled with the exact ambient sounds + signature-timbre cues), mix_notes, transition_note`.
- **Roles per batch:** Short Noir Intro (BPM 58–72, ~2 min) / Dark Jazz Deep Focus (**BPM 60–75**, 3–4 min, negative-space emphasis) / Dark Jazz Sleep Noir (42–58, long). v3 head adds signature timbres: vibraphone, arco/bowed double bass, bass clarinet, mellotron, reverb/delay electric guitar (sax/trumpet/upright/Rhodes/noir piano stay the core).
- **Code:** `handleD2ADone/BDone` append + advance; `handleD2CDone` appends, initializes `audio[]` **and the ambient bed** (`ambientBedAudio`), sets `suno_pending`. `parseTrackSpecs` **caps to the batch size**. `style_tags` go to Suno `tags`, `structure` to Suno `lyrics`.

### D3 — Thumbnail (v2) = Section 3
- **In:** `[SCENE_NAME]`, `[VISUAL_HIGHLIGHTS]`, `[ACCENT_COLOR]`.
- **Out:** JSON `{ strategy:{composition,color_palette,ctr_hook,dark_jazz_signal}, nano_banana_prompt }`.
- **Code:** `handleD3Done` stores `thumbnail`, enqueues D4. Render is manual/local. Any secondary figures in the thumbnail prompt must be non-human robots/androids/machines.

### D4 — SEO Package (v2) = Section 4
- **In:** `[SCENE_NAME]`, `[AMBIENT_SOUND_MAP]`, `[TRACK_TITLES]`.
- **Out (creative copy only):** JSON `{ titles[5], best_title, slug, pov_intro, scene_details, pinned_comment, hidden_tags, playlists[5] }`. The prompt explicitly tells the model **not** to produce soundscape/specs/chapters/hashtags — code assembles those.
- **Code:** `handleD4Done` → `parseD4Variable` → `buildChaptersFromAudio` (real durations) → `buildDescription` → stores `ytTitle/ytSlug/ytDescription/ytTags/ytChapters/ytPinnedComment/ytPlaylists`, sets `ready`, Telegram alert with the local project folder.

---

## 5b. Verbatim prompt text

Active templates from `dr_prompt_versions`. **D1 and D2A/B/C are v3**; D0/D3/D4 are v2.
The D1 block below is current (v3). The **D2A/B/C blocks below are the v2 base** — the v3
diffs (harmonic palette `[HARMONIC_PALETTE]` input, signature timbres in CORE GENRE LOCK +
structure, key/mode in `style_tags`, D2B BPM 60-75 + negative space) are summarized in §5 and
the changelog; the exact current v3 text is in `scripts/update-prompts.ts`. `[TOKENS]` are
filled by `interpolate()` at enqueue time. Every prompt opens with its role line then this
shared block — shown once here, referenced as `‹DNA LOCK›` in each prompt below:

```text
## GLOBAL CHANNEL DNA LOCK
- Cyberpunk Noir + Dark Jazz + Strict 16-bit Pixel Art + Rainy City Ambience.
- Dark Jazz is the main sonic identity. Cyberpunk is the world. Pixel art is the visual language. Ambient sound is the connective tissue.
- Everything must feel like a lonely late-night cyberpunk jazz session inside a rain-soaked pixel city.
- NEVER drift into: Pure Synthwave, EDM, Progressive House, Trap, Pop, Rock, cheerful cafe jazz, generic lo-fi hip hop, photorealism, 3D CGI, smooth gradients, modern vector art, glossy AI fantasy art, bright motivational music.
```

### D0 (verbatim)
```text
You are the Executive Creative Director for the YouTube channel "Drifter 2077".

‹DNA LOCK›

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

Return ONLY the JSON array. No markdown fences, no commentary.
```

### D1 (verbatim)
```text
You are the Executive Creative Director for the YouTube channel "Drifter 2077".

‹DNA LOCK›

## INPUT SCENE
[SCENE_INPUT]

## TASK
Define the visual scene, loopable video motion, the ambient sound map, and the harmonic palette that will later dictate the Dark Jazz music.

### IMAGE PROMPT (Nano Banana) — must include:
- STYLE LOCK: strict 16-bit retro pixel art, 2D side-scrolling view, flat perspective, cyberpunk noir, high-contrast chiaroscuro, heavy dithering, visible scanlines, limited palette with neon highlights, sharp blocky pixels, nearest-neighbor, no anti-aliasing.
- NEGATIVE: no 3D, no photorealism, no modern CGI, no smooth gradients/bokeh/vector art, no anime, no painterly brushwork, no soft blur, no readable text.
- CHARACTER DNA "The Watcher": solitary pixel figure in profile/side view, rain-soaked dark trench coat and wide-brimmed fedora, face hidden in shadow, only a tiny orange pixel cigarette glow, brooding/static/tired/observant.
- NON-HUMAN NPCS ONLY: 1-2 secondary foreground/background figures must be robots, androids, drones, vending machines, service machines, mechanical cooks, maintenance bots, holographic kiosks, or other believable cyberpunk machinery that fits the specific scene. Do NOT depict ordinary humans as NPCs; The Watcher is the only human-like figure.
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

Return ONLY the JSON object. No markdown fences, no commentary.
```

### D2A / D2B / D2C (verbatim)
All three share the same head; only the role line, the `## THIS BATCH` block and the
final count differ. Head (identical for A/B/C):
```text
You are the Audio Architect for the YouTube channel "Drifter 2077".

‹DNA LOCK›

## CORE GENRE LOCK
Dark Jazz must always be dominant. Core sound: smoky tenor/baritone saxophone, muted trumpet, flugelhorn, upright bass, brushed jazz drums, Rhodes electric piano, sparse noir piano, low analog synth pads, tape hiss, vinyl crackle, distant neon hum, rain ambience, subtle 16-bit retro texture. Synthwave/ambient drone/chip texture allowed ONLY as background atmosphere — never replacing Dark Jazz.
DO NOT generate: EDM, Progressive House, Trap, Pop, Rock, orchestral trailer, cheerful cafe jazz, upbeat swing, generic lo-fi hip hop, pure synthwave, pure ambient drone, robotic AI music.

## HUMAN PERFORMANCE FEEL
Must feel performed by tired, expressive human jazz musicians in a late-night underground bar: slight timing looseness, breathy sax, imperfect trumpet attacks, soft brushed drums, walking bass, sparse piano, natural pauses. Avoid quantized robotic rhythm.

## MOOD LOCK
Melancholic, lonely, cinematic, slow, shadowy, rain-soaked, late-night, reflective, mysterious, restrained, noir, urban, intimate. Never heroic, bright, motivational, epic, or cheerful.

## INPUT — SCENE: [SCENE_NAME]
## INPUT — AMBIENT SOUND MAP (preserve these EXACT sounds inside each track structure):
[AMBIENT_SOUND_MAP]

## PER-TRACK OUTPUT FIELDS
- title: song title
- role: the track role for this batch (given below)
- youtube_use_case: one of [Rainy Night, Coding, Study, Writing, Sleep, Detective Noir, Neon Lounge]
- style_tags: UNDER 1000 characters. Comma-separated Dark Jazz style tags + main instruments + compressed ambient aliases + BPM. ALWAYS end with: "Instrumental only, No vocals, No lyrics, Human feel, High fidelity, Masterpiece". Do NOT paste the full ambient map here — use short aliases only.
- structure: the full structure template for this batch, with [SFX: ...] lines filled with the EXACT ambient sounds above. Start with [Instrumental Only][No Vocals][No Lyrics][No Spoken Word].
- mix_notes: short note on how ambience, jazz instruments, bass, drums and synth texture sit in the mix
- transition_note: how this track fades/loops/connects into the next track for playlist flow
```
Per-batch tail:
```text
# D2A:
## THIS BATCH — Tracks 1-5: SHORT NOIR INTRO
- role value: "Short Noir Intro"
- BPM 58-72, ~2 minutes each.
- Structure template:
[Short Intro] / [SFX: Ambient Bed] / [SFX: Tonal Hum] / [Noir Piano Entrance] / [Upright Bass Pulse] / [Muted Trumpet Motif] / [SFX: Rhythmic Texture] / [Breathy Sax Phrase] / [Soft Brush Drums] / [SFX: Human Trace] / [Fade Out into Silence Gap]

## OUTPUT
CRITICAL: output EXACTLY 5 objects — not 6, not more, not fewer. Count them before returning.
Return ONLY a JSON array of those 5 track objects with the fields described above. No markdown fences, no commentary.

# D2B:
## THIS BATCH — Tracks 6-15: DARK JAZZ DEEP FOCUS
- role value: "Dark Jazz Deep Focus"
- BPM 68-84, 3-4 minutes each.
- Structure template:
[Structure: Full Instrumental Song] / [Intro: tape hiss + Ambient Bed] / [Verse 1: Rhodes chords and upright bass] / [Muted Trumpet Theme] / [SFX: Tonal Hum] / [Verse 2: brushed drums and noir piano] / [SFX: Rhythmic Texture] / [Smoky Sax Solo] / [Bridge: low analog synth pad and distant neon hum] / [SFX: Human Trace] / [Extended Improvisation] / [Final Theme] / [Outro: vinyl crackle, fading bass, Silence Gap]

## OUTPUT
CRITICAL: output EXACTLY 10 objects — not 11, not 20, not fewer. Count them before returning.
Return ONLY a JSON array of those 10 track objects with the fields described above. No markdown fences, no commentary.

# D2C:
## THIS BATCH — Tracks 16-20: DARK JAZZ SLEEP NOIR
- role value: "Dark Jazz Sleep Noir"
- BPM 42-58, long and slow.
- Structure template:
[Structure: Dark Jazz Sleep Noir] / [Long Wash] / [SFX: Ambient Bed] / [Soft Rhodes Pad] / [Distant Saxophone] / [SFX: Tonal Hum] / [Muted Trumpet Echo] / [Upright Bass Drone] / [SFX: Rhythmic Texture] / [Noir Piano Fragments] / [SFX: Human Trace] / [Drifting Pads] / [Very Slow Fade Out] / [Seamless Loop Tail into Silence Gap]

## OUTPUT
CRITICAL: output EXACTLY 5 objects — not 6, not more, not fewer. Count them before returning.
Return ONLY a JSON array of those 5 track objects with the fields described above. No markdown fences, no commentary.
```

### D3 (verbatim)
```text
You are a YouTube Thumbnail Designer specialized in Cyberpunk Noir Dark Jazz 16-bit Pixel Art for the channel "Drifter 2077".

‹DNA LOCK›

## INPUT
SCENE NAME: [SCENE_NAME]
VISUAL HIGHLIGHTS: [VISUAL_HIGHLIGHTS]
ACCENT COLOR: [ACCENT_COLOR]

## RULES
- 16:9 aspect ratio, strict 16-bit pixel art, sharp blocky pixels, heavy dithering, visible scanlines, high-contrast chiaroscuro, limited palette.
- Visual continuity with video: thumbnail must feel like a stronger hero-frame crop from the exact same video scene, preserving the same location, weather, accent color, Warm-vs-Cold palette, foreground/midground/background layer logic, The Watcher design, and non-human NPC rule. Do NOT invent a different setting, different character design, or unrelated props just for CTR.
- The Watcher is the clear silhouette anchor; the orange cigarette glow must read at small size; strong dithered rim light around fedora/coat/shoulders.
- If any secondary figures appear, they must be robots, androids, drones, vending machines, service machines, mechanical cooks, maintenance bots, holographic kiosks, or other scene-appropriate machinery. Do NOT include ordinary human NPCs; The Watcher is the only human-like figure.
- Layered pixel parallax depth (not photographic DoF), blocky pixel neon glow (not smooth bloom), 2-4 subtle dark-jazz cues, one clean dark negative-space area for optional text.
- NO text/letters/readable signs in the image. No 3D, photorealism, smooth gradients/bokeh, modern CGI, vector art, anime, soft blur.

## OUTPUT
Return ONLY a JSON object with exactly these fields:
- strategy: an object with { composition, color_palette, ctr_hook, dark_jazz_signal } (each a short string)
- nano_banana_prompt: the full thumbnail prompt as a single string (FORMAT / SUBJECT / BACKGROUND / DARK JAZZ NOIR DETAILS / LIGHTING / COMPOSITION / VISUAL CONTINUITY WITH VIDEO / NEGATIVE CONSTRAINT)

Return ONLY the JSON object. No markdown fences, no commentary.
```

### D4 (verbatim)
```text
You are a YouTube SEO Specialist & Copywriter for the high-end Cyberpunk Noir Dark Jazz Pixel Art channel "Drifter 2077".

‹DNA LOCK›

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
- pov_intro: a moody cinematic noir paragraph beginning "POV:\nYou are The Watcher.\nYou found a moment of quiet at [SCENE_NAME]..." then describing the scene
- scene_details: 1-2 sentences mentioning the visual highlights of this pixel art loop
- pinned_comment: a full pinned comment in the voice of The Watcher, opening "Day [number 400-900] in the city." and ending with a specific question about the scene/mood/soundscape, signed "— The Watcher"
- hidden_tags: a single comma-separated string of YouTube tags (include dark jazz, noir jazz, doom jazz, cyberpunk jazz, film noir jazz, rainy night jazz, jazz for coding/studying/sleep, cyberpunk ambience, 16-bit pixel art, neon city ambience, smoky saxophone, muted trumpet, upright bass, plus scene-specific keywords)
- playlists: array of 5 playlist title ideas

Return ONLY the JSON object. No markdown fences, no commentary.
```

---

## 6. Status state machine (`dr_episodes.status`)

```
d0_pending → d1_pending → d2a_pending → d2b_pending → d2c_pending → suno_pending → d3_pending → d4_pending → ready → image_gen_pending → assembly_pending → assembly_done
                                                                                                          any → needs_attention
```

`ready` = all automated stages done; the rest (image render, Veo loop, ffmpeg assembly, publish) is the **deferred local pipeline**.
