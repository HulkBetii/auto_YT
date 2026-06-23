import type { AmbientSoundMap, HarmonicPalette, SceneInput } from "@/lib/db/schema";

/** Renders a 5-field scene into the [SCENE_INPUT] block D1 expects. */
export function formatSceneInput(scene: SceneInput): string {
  return [
    `SCENE NAME: ${scene.scene_name}`,
    `VISUAL HIGHLIGHTS: ${scene.visual_highlights}`,
    `ATMOSPHERE / MOOD: ${scene.atmosphere_mood}`,
    `ACCENT COLOR: ${scene.accent_color}`,
    `MUSIC ROLE: ${scene.music_role}`,
  ].join("\n");
}

/** Renders the ambient sound map into the [AMBIENT_SOUND_MAP] block D2/D4 expect. */
export function formatAmbientSoundMap(a: AmbientSoundMap): string {
  return [
    `Ambient Bed: ${a.ambient_bed}`,
    `Tonal Hum: ${a.tonal_hum}`,
    `Rhythmic Texture: ${a.rhythmic_texture}`,
    `Human Trace: ${a.human_trace}`,
    `Silence Gap: ${a.silence_gap}`,
  ].join("\n");
}

/** Renders the harmonic palette into the [HARMONIC_PALETTE] block D2 expects. */
export function formatHarmonicPalette(h: HarmonicPalette): string {
  return [
    `Key Center: ${h.key_center}`,
    `Mode: ${h.mode}`,
    `Tempo Anchor (BPM): ${h.tempo_anchor_bpm}`,
  ].join("\n");
}

/** Validates D1's harmonic_palette: non-empty key/mode, tempo in 40–84. */
export function parseHarmonicPalette(value: unknown): HarmonicPalette | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const key = typeof obj.key_center === "string" ? obj.key_center.trim() : "";
  const mode = typeof obj.mode === "string" ? obj.mode.trim() : "";
  const tempo = typeof obj.tempo_anchor_bpm === "number" ? obj.tempo_anchor_bpm : NaN;
  if (!key || !mode || !Number.isFinite(tempo) || tempo < 40 || tempo > 84) return null;
  return { key_center: key, mode, tempo_anchor_bpm: Math.round(tempo) };
}

const SCENE_FIELDS: (keyof SceneInput)[] = [
  "scene_name",
  "visual_highlights",
  "atmosphere_mood",
  "accent_color",
  "music_role",
];

/** Validates a manually-entered scene has all 5 non-empty string fields. */
export function parseSceneInput(value: unknown): SceneInput | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  for (const field of SCENE_FIELDS) {
    if (typeof obj[field] !== "string" || !(obj[field] as string).trim()) return null;
  }
  return obj as unknown as SceneInput;
}

/** Maps a D-stage to the episode status it should resume at. */
export const STAGE_TO_EPISODE_STATUS: Record<string, string> = {
  D0: "d0_pending",
  D1: "d1_pending",
  D2A: "d2a_pending",
  D2B: "d2b_pending",
  D2C: "d2c_pending",
  D3: "d3_pending",
  D4: "d4_pending",
};
