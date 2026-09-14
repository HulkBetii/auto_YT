import { config } from "dotenv";

config({ path: ".env.local" });
config();

const baseUrl = process.env.KO_WEB_URL ?? "http://127.0.0.1:3003";
const youtubeUrl = process.env.KO_E2E_YOUTUBE_URL;
const dashboardSecret = process.env.DASHBOARD_SECRET?.trim() ?? "";
const timeoutMs = 90 * 60 * 1000;
const authorizationHeaders = dashboardSecret ? { Authorization: `Bearer ${dashboardSecret}` } : {};

if (!youtubeUrl) throw new Error("Set KO_E2E_YOUTUBE_URL to a short Korean YouTube video.");

const createdResponse = await fetch(`${baseUrl}/api/videos`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...authorizationHeaders },
  body: JSON.stringify({ url: youtubeUrl }),
});
const created = (await createdResponse.json()) as { ok: boolean; videoId?: number; error?: string };
if (!createdResponse.ok || !created.ok || !created.videoId) throw new Error(created.error ?? "Video creation failed.");

const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  await fetch(`${baseUrl}/api/pipeline/run`, { method: "POST", headers: authorizationHeaders });
  const response = await fetch(`${baseUrl}/api/videos/${created.videoId}`, {
    headers: authorizationHeaders,
  });
  const state = (await response.json()) as { video?: { status: string; errorMessage?: string } };
  if (state.video?.status === "ready") {
    const download = await fetch(`${baseUrl}/api/videos/${created.videoId}/download`, {
      headers: authorizationHeaders,
    });
    const script = await download.text();
    if (!download.ok || !script.trim() || script.startsWith("Title:")) {
      throw new Error("Ready video did not expose a valid body-only TXT download.");
    }
    console.log(`KO E2E ready: ${baseUrl}/videos/${created.videoId}`);
    process.exit(0);
  }
  if (state.video?.status === "needs_attention") throw new Error(state.video.errorMessage ?? "Pipeline needs attention.");
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
throw new Error(`KO E2E timed out after ${timeoutMs / 60_000} minutes.`);
