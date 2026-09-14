import { z } from "zod";

const YT_PRO_MAX_URL = process.env.YT_PRO_MAX_URL ?? "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 15_000;

const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().optional(),
});

const transcriptJobSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  progress: z.number(),
  language: z.string().nullable().optional(),
  language_confidence: z.number().nullable().optional(),
  video: z
    .object({
      id: z.string(),
      title: z.string(),
      webpage_url: z.string(),
    })
    .nullable()
    .optional(),
  artifacts: z.object({ txt: z.string(), json: z.string() }).nullable().optional(),
  error: errorSchema.nullable().optional(),
  cached: z.boolean().optional(),
});

export type TranscriptJob = z.infer<typeof transcriptJobSchema>;

const transcriptArtifactSchema = z.object({
  video: z.object({
    id: z.string(),
    title: z.string(),
    duration_seconds: z.number(),
  }),
  segments: z.array(
    z.object({
      index: z.number().int().positive(),
      start_ms: z.number().int().nonnegative(),
      end_ms: z.number().int().positive(),
      text: z.string().min(1),
    }),
  ).min(1),
});

export type TranscriptArtifact = z.infer<typeof transcriptArtifactSchema>;

export function parseTranscriptJsonArtifact(value: unknown): TranscriptArtifact {
  return transcriptArtifactSchema.parse(value);
}

export function selectTranscriptSegments(
  artifact: TranscriptArtifact,
  startSegment: number,
  endSegment: number,
) {
  return artifact.segments.filter(
    (segment) => segment.index >= startSegment && segment.index <= endSegment,
  );
}

async function request(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(pathname, YT_PRO_MAX_URL), {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
}

async function parseJobResponse(response: Response): Promise<TranscriptJob> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body === "object" && "detail" in body ? body.detail : body;
    throw new Error(`YT_Pro_Max HTTP ${response.status}: ${JSON.stringify(detail)}`);
  }
  return transcriptJobSchema.parse(body);
}

export async function submitTranscriptJob(url: string): Promise<TranscriptJob> {
  const response = await request("/api/v1/transcript-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, language: "ko" }),
  });
  return parseJobResponse(response);
}

export async function getTranscriptJob(jobId: string): Promise<TranscriptJob> {
  const response = await request(`/api/v1/transcript-jobs/${encodeURIComponent(jobId)}`);
  return parseJobResponse(response);
}

export async function downloadTranscriptArtifact(artifactUrl: string): Promise<string> {
  const response = await fetch(new URL(artifactUrl, YT_PRO_MAX_URL), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Transcript artifact download failed with HTTP ${response.status}.`);
  return response.text();
}

export async function downloadTranscriptJsonArtifact(artifactUrl: string): Promise<TranscriptArtifact> {
  const response = await fetch(new URL(artifactUrl, YT_PRO_MAX_URL), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Transcript JSON artifact download failed with HTTP ${response.status}.`);
  return parseTranscriptJsonArtifact(await response.json());
}

export async function getYtProMaxHealth(): Promise<{ online: boolean; status: string; error?: string }> {
  try {
    const response = await request("/api/v1/health");
    if (!response.ok) return { online: false, status: `http_${response.status}` };
    const body = (await response.json()) as { status?: string };
    return { online: body.status === "ok" || body.status === "degraded", status: body.status ?? "unknown" };
  } catch (error) {
    return { online: false, status: "offline", error: error instanceof Error ? error.message : String(error) };
  }
}

export function parseTranscriptText(value: string): { title: string; body: string } {
  const normalized = value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  const match = normalized.match(/^Title:\s*(.+)\n\s*\n([\s\S]+)$/);
  if (!match) throw new Error("Transcript TXT must start with 'Title: <title>' followed by a blank line.");
  const title = match[1].trim();
  const body = match[2].trim();
  if (!title || !body) throw new Error("Transcript title or body is empty.");
  return { title, body };
}

export function getHangulLetterRatio(value: string): number {
  const letters = value.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const hangul = value.match(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g) ?? [];
  return hangul.length / letters.length;
}

export function assertKoreanTranscript(job: TranscriptJob, body: string): void {
  if (!job.language?.toLowerCase().startsWith("ko")) {
    throw new Error(`YT_Pro_Max detected language '${job.language ?? "unknown"}', expected Korean.`);
  }
  const ratio = getHangulLetterRatio(body);
  if (ratio < 0.5) throw new Error(`Transcript Hangul ratio ${ratio.toFixed(2)} is below 0.50.`);
}
