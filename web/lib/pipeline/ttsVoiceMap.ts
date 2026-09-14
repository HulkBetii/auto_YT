/**
 * Server-side helper for checking TTS voice mapping status.
 * Used by both the pipeline (tts.ts) and dashboard UI pages.
 */
import { getConfigValue } from "@/lib/db/repo/channel-config";
import type { TtsUiState } from "@/lib/ui/operations";
import { lookupVoiceInMap } from "./tts";

const RECENT_SUBMISSION_MS = 30 * 1000;

export type TTSStatus = TtsUiState;

/**
 * Fetches the voice map from channel_config and returns a function that
 * computes the TTS status for any (featuredPerson, audioUrl) pair.
 * Fetches the config only once — call this once per page render.
 */
export async function buildTTSStatusChecker(): Promise<
  (input: {
    featuredPerson: string | null;
    audioUrl: string | null | undefined;
    ttsTaskId?: string | null;
    ttsSubmittedAt?: Date | string | null;
  }) => TTSStatus
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

  return ({ featuredPerson, audioUrl, ttsTaskId, ttsSubmittedAt }) => {
    if (audioUrl) return "done";
    if (!featuredPerson || !lookupVoiceInMap(voiceMap, featuredPerson)) {
      return "no_mapping";
    }
    if (ttsTaskId) {
      const submittedAt = ttsSubmittedAt ? new Date(ttsSubmittedAt).getTime() : 0;
      return submittedAt > 0 && Date.now() - submittedAt <= RECENT_SUBMISSION_MS
        ? "submitted"
        : "running";
    }
    return "waiting_submit";
  };
}
