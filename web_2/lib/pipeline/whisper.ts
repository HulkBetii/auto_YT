import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Downloads audio from audioUrl, transcribes via Whisper with segment timestamps,
 * and returns a formatted string where each line is "[MM:SS] narration text".
 */
export async function transcribeAudio(audioUrl: string): Promise<string> {
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    throw new Error(`[whisper] Failed to fetch audio: HTTP ${audioRes.status}`);
  }

  const buffer = await audioRes.arrayBuffer();
  const file = new File([buffer], "audio.mp3", { type: "audio/mpeg" });

  const transcription = await client.audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments =
    (transcription as unknown as { segments?: Array<{ start: number; text: string }> }).segments ?? [];

  if (segments.length === 0) {
    // Fallback: return plain text without timestamps
    return transcription.text ?? "";
  }

  return segments
    .map((seg) => `[${formatTime(seg.start)}] ${seg.text.trim()}`)
    .join("\n");
}
