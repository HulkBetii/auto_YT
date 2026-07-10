# Web2 Prompt Sets + Code Support Notes

Source of truth:
- `scripts/update-prompts.ts` updates `2.1-Mack-YT`.
- `scripts/update-stickly-prompts.ts` updates `2.2-Stickly-YT`.
- `scripts/update-explain-in-paint-prompts.ts` updates `2.3-Explain-In-Paint-YT`.

All are selectable prompt sets. None replaces `current` unless a video is explicitly created with that set.

## Shared Pipeline Contract

1. `S1` generates 5 JSON topic candidates.
2. Code parses candidates, ranks them, saves `topicCandidates` and `chosenTopic`, then enqueues `S2`.
3. `S2` writes the narration script.
4. Code sends the script through TTS, sanitizes narration text before provider submit, then creates a Whisper/timestamp transcript.
5. `S3` converts timestamped narration into image prompts.
6. Code sanitizes and wraps image prompts with the house doodle style.
7. `S4` creates YouTube packaging JSON.
8. Code parses S4 JSON, wraps the thumbnail concept with the same doodle style, builds chapters/description/tags/thumbnail metadata, then marks the video ready.

## Shared Placeholders

- S1: `[RECENT_TOPICS]`
- S2: `[TOPIC_TITLE]`, `[TOPIC_ANGLE]`, `[HOOK]`, `[KEY_QUESTIONS]`
- S3: `[TIMESTAMPED_SCRIPT]`
- S4: `[TOPIC_TITLE]`, `[HEAD_KEYWORD]`, `[SCRIPT_EXCERPT]`

## Shared Code-Enforced Behavior

- Videos store `promptSetVersion` on `ah_videos`; jobs resolve active prompts by `promptKey + promptSetVersion`.
- Only prompt sets with active `S1/S2/S3/S4` rows are available in the creation dropdown.
- S1 output must parse as an array with expected fields: `title`, `head_keyword`, `angle`, `hook`, `viral_type`, `key_questions`.
- S2 output is saved as plain script text and passed to TTS/Whisper.
- S3 output is line-formatted, sanitized, and wrapped by `lib/pipeline/visualStyle.ts`.
- S4 output must satisfy `parseS4Variable`: `title`, `url_slug`, `hook_paragraph`, `discover_bullets`, `chapter_titles`, `tags`, `thumbnail` with `concept`, `text`, `emotion`, `accent_color`.
- Code computes real chapter timestamps, builds the final description, normalizes tags, and wraps `thumbnail.concept` before storing it.

## `2.1-Mack-YT`

Mack-YT is about familiar modern human life explained through hidden ancient origins. It takes something recognizable from modern behavior, objects, body traits, private problems, relationships, or animal encounters; reveals the hidden question; traces it through prehistory, archaeology, evolution, biology, ecology, or cultural history; then returns to the viewer with a surprising human continuity.

Prompt-guided Mack behavior includes:
- S1: familiar modern thing + hidden question + ancient/evolutionary/history explanation + strong visual packaging.
- S2: 2,800-3,500 words, mixed POV, modular documentary structure, evidence anchors, evidence ladder, research discipline, retention mechanics, and TTS readability.
- S3: coherent visual documentary sequence with historical reconstruction, human problem, evidence visualization, mechanism explanation, comparison, timeline/migration, modern analogy, and uncertainty frames.
- S4: title/thumbnail division of labor and one dominant visual proposition rather than exactly one hero character.

## `2.2-Stickly-YT`

Stickly-YT is distinct from Mack-YT. It is not just Mack with more animal topics. Its identity is familiar human situations, vulnerabilities, impulses, and ancient-life conditions explained through behavioral paradoxes, animal behavior, evolutionary biology, ecology, neuroscience, and deep human history.

Core Stickly mechanic: familiar situation + apparent contradiction + layered causal explanation + surprising evidence + reframe of the original situation.

Prompt-guided Stickly behavior includes:
- S1 topic engines: human-animal danger paradox, unexpected trust/help behavior, universal human impulses toward animals, ancient everyday conditions, body/evolution mismatch, coevolution/domestication, and selective broader behavioral science.
- S1 observable-behavior rule: describe what animals do before interpreting why; avoid unsupported mind-reading.
- S2: 2,900-3,600 words, aim 3,200-3,400, with adaptive modes Behavior Paradox, Ancient Condition, and Human Urge Mechanism.
- S2 epistemic discipline: separate behavior, interpretation, evidence, inference, speculation; distinguish mechanism plausibility from demonstrated outcome.
- S3 prioritizes interaction geometry, species specificity, gaze, movement direction, relative distance, behavioral sequence continuity, animal body language, and mechanism visualization.
- S4 uses ONE FOCAL INTERACTION + ONE BEHAVIORAL TENSION, where title usually states observable behavior/condition and thumbnail text adds emotional interpretation or contradiction.

## `2.3-Explain-In-Paint-YT`

Explain-In-Paint-YT is distinct from Mack and Stickly. It is not Mack with more science, Stickly without animals, a generic science facts channel, or a generic ancient-history channel.

Core Explain-In-Paint mechanic: simple question + hidden system + mechanism chain + evidence + surprising implication + one clean final principle.

Prompt-guided Explain-In-Paint behavior includes:
- S1 topic engines: System Under Pressure, Invisible Everyday Mechanism, Major Transformation, Hidden Social System, Perspective Reconstruction, and selective Human-Animal Systems.
- S1 favors specific system questions over broad topics, semantic duplicate avoidance, hidden systems, and mechanism chains.
- S2: 3,000-3,600 words, aim 3,200-3,400, with System Under Pressure, Mechanism Descent, and Transformation Story architectures.
- S2 bans drafting leakage and word-count commentary, prevents post-conclusion padding, distinguishes simple explanation from false simplification, calibrates causal/evidence levels, maps consensus for debated topics, and includes health/medical/parenting safeguards.
- S3 uses an Explanatory Visual Ladder: anchor scene, problem, system map, mechanism, comparison, evidence, feedback, transformation, return, and perspective reconstruction.
- S4 uses ONE EXPLANATORY PUZZLE + ONE PRIMARY VISUAL CLUE + ONE COMPRESSED QUESTION, without exactly-one-hero framing.

## Prompt-Guided, Not Code-Enforced

Do not treat these as validators unless code is added later:
- exact topic diversity or exact content-engine representation;
- semantic diversity quality;
- exact word count;
- evidence quality or evidence count;
- causal-layer count;
- animal epistemic quality;
- study-separation quality;
- consensus calibration;
- mechanism correctness;
- visual ladder or interaction geometry quality;
- thumbnail originality, title uniqueness, or visual readability;
- absence of padding beyond basic output sanitation.

## Runtime Support Outside Prompts

- RUN_VEO import syncs latest Web2 project data before local cache fallback.
- RUN_VEO setup clears old project folders before writing fresh prompts/artifacts.
- RUN_VEO BGM sidecar can create `final_video_bgm.mp4` after `final_video.mp4`, using local `ah_bgm` with 1-second crossfades.
