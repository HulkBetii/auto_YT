function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type WhisperTranscription = {
  text?: string;
  segments?: Array<{ start: number; text: string }>;
};

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("[whisper] OPENAI_API_KEY env var is not set");
  }

  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("file", new File([buffer], "audio.mp3", { type: "audio/mpeg" }));

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[whisper] OpenAI transcription HTTP ${res.status}: ${body}`);
  }

  const transcription = (await res.json()) as WhisperTranscription;
  const segments = transcription.segments ?? [];

  if (segments.length === 0) {
    // Fallback: return plain text without timestamps
    return transcription.text ?? "";
  }

  return segments
    .map((seg) => `[${formatTime(seg.start)}] ${seg.text.trim()}`)
    .join("\n");
}
