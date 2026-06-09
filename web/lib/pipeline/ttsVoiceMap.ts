/**
 * Server-side helper for checking TTS voice mapping status.
 * Used by both the pipeline (tts.ts) and dashboard UI pages.
 */
import { getConfigValue } from "@/lib/db/repo/channel-config";
import { lookupVoiceInMap } from "./tts";

export type TTSStatus =
  | "done"          // audio_url is set
  | "pending"       // has voice mapping, waiting for cron
  | "no_mapping";  // no voice mapping configured for this person

/**
 * Fetches the voice map from channel_config and returns a function that
 * computes the TTS status for any (featuredPerson, audioUrl) pair.
 * Fetches the config only once — call this once per page render.
 */
export async function buildTTSStatusChecker(): Promise<
  (featuredPerson: string | null, audioUrl: string | null | undefined) => TTSStatus
> {
  const mapJson = await getConfigValue("tts_voice_map");
  let voiceMap: Record<string, string> = {};
  if (mapJson) {
    try {
      voiceMap = JSON.parse(mapJson) as Record<string, string>;
    } catch {
      // malformed JSON — treat as empty map
    }
  }

  return (featuredPerson, audioUrl) => {
    if (audioUrl) return "done";
    if (!featuredPerson) return "no_mapping";
    const mapped = lookupVoiceInMap(voiceMap, featuredPerson);
    return mapped ? "pending" : "no_mapping";
  };
}
