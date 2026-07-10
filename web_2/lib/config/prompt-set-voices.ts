import { getAhConfigValue } from "@/lib/db/repo/channel-config";
import { AH_CONFIG_KEYS } from "@/lib/db/schema";

export const PROMPT_SET_VOICE_CONFIG_KEYS = {
  "2.1-Mack-YT": AH_CONFIG_KEYS.voiceIdMackYt,
  "2.2-Stickly-YT": AH_CONFIG_KEYS.voiceIdSticklyYt,
  "2.3-Explain-In-Paint-YT": AH_CONFIG_KEYS.voiceIdExplainInPaintYt,
} as const;

export type PromptSetWithVoice = keyof typeof PROMPT_SET_VOICE_CONFIG_KEYS;

export function getPromptSetVoiceConfigKey(promptSetVersion: string): string | null {
  return PROMPT_SET_VOICE_CONFIG_KEYS[promptSetVersion as PromptSetWithVoice] ?? null;
}

export async function getPromptSetVoiceId(promptSetVersion: string): Promise<string | null> {
  const configKey = getPromptSetVoiceConfigKey(promptSetVersion);
  if (!configKey) return null;

  const value = await getAhConfigValue(configKey);
  const voiceId = value?.trim();
  return voiceId || null;
}
