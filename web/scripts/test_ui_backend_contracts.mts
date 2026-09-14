import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { SETTINGS_FIELDS } from "../lib/settings/fields.js";
import {
  classifyTtsCycleResult,
  deriveRenderUiState,
  TTS_STATE_PRESENTATION,
} from "../lib/ui/operations.js";

assert.equal(classifyTtsCycleResult({ ok: true }), "completed");
assert.equal(
  classifyTtsCycleResult({ ok: false, error: "submitted" }),
  "submitted",
);
assert.equal(
  classifyTtsCycleResult({ ok: false, error: "running" }),
  "running",
);
assert.equal(
  classifyTtsCycleResult({ ok: false, error: "no_voice_mapping" }),
  "blocked",
);
assert.equal(
  classifyTtsCycleResult({ ok: false, error: "stale_cancelled after 16min" }),
  "retrying",
);
assert.equal(classifyTtsCycleResult({ ok: false, error: "HTTP 500" }), "failed");
assert.equal(TTS_STATE_PRESENTATION.submitted.label, "Đã gửi TTS");
assert.equal(TTS_STATE_PRESENTATION.running.label, "Đang tạo audio");

assert.equal(
  deriveRenderUiState({
    audioUrl: null,
    renderStatus: "not_started",
  }),
  "waiting_audio",
);
assert.equal(
  deriveRenderUiState({
    audioUrl: "audio.mp3",
    ttsText: null,
    renderStatus: "not_started",
  }),
  "blocked_missing_text",
);
assert.equal(
  deriveRenderUiState({
    audioUrl: "audio.mp3",
    ttsText: "narration",
    renderStatus: "failed",
    renderAttemptCount: 2,
    renderNextAttemptAt: new Date(),
  }),
  "retry_scheduled",
);
assert.equal(
  deriveRenderUiState({
    audioUrl: "audio.mp3",
    ttsText: "narration",
    renderStatus: "rendering",
    outputAvailable: true,
  }),
  "rendering_old_output",
);
assert.equal(
  deriveRenderUiState({
    audioUrl: "audio.mp3",
    ttsText: "narration",
    renderStatus: "done",
    outputAvailable: true,
    outputCurrent: true,
  }),
  "done",
);
assert.equal(
  deriveRenderUiState({
    audioUrl: "audio.mp3",
    ttsText: "narration",
    renderStatus: "failed",
    renderAttemptCount: 4,
    renderNextAttemptAt: null,
    outputAvailable: true,
  }),
  "failed_old_output",
);

const settings = new Map(SETTINGS_FIELDS.map((field) => [field.key, field]));
assert(settings.get("new_batch_paused")?.schema.safeParse("true").success);
assert(settings.get("new_batch_paused")?.schema.safeParse("false").success);
assert(!settings.get("new_batch_paused")?.schema.safeParse("paused").success);

const processNowSource = await readFile(
  new URL("../app/api/jobs/process-now/route.ts", import.meta.url),
  "utf8",
);
assert(!processNowSource.includes("maybeStartNewBatch"));
assert(processNowSource.includes("runChainCycle()"));
assert(processNowSource.includes("runTTSForReadyVideos()"));
assert(processNowSource.includes("p5Triggered"));
assert(processNowSource.includes("p6Batch"));

const startBatchSource = await readFile(
  new URL("../app/api/jobs/start-batch/route.ts", import.meta.url),
  "utf8",
);
assert(startBatchSource.includes("maybeStartNewBatch()"));
assert(startBatchSource.includes("status: batch.triggered ? 200 : 409"));

const batchSource = await readFile(
  new URL("../lib/pipeline/batch.ts", import.meta.url),
  "utf8",
);
const pauseGuard = batchSource.indexOf('getConfigValue("new_batch_paused")');
const videoGuard = batchSource.indexOf("inFlightVideos.length > 0");
const jobGuard = batchSource.indexOf("inFlightJobs.length > 0");
const enqueue = batchSource.indexOf("enqueueStage({");
assert(pauseGuard >= 0 && pauseGuard < enqueue);
assert(videoGuard >= 0 && videoGuard < enqueue);
assert(jobGuard >= 0 && jobGuard < enqueue);

const dashboardSource = await readFile(
  new URL("../app/(dashboard)/page.tsx", import.meta.url),
  "utf8",
);
assert(dashboardSource.includes('"Desc"'));
assert(dashboardSource.includes('"Render"'));
assert(dashboardSource.includes("isCurrentRenderComplete"));
assert(dashboardSource.includes("TtsStatusBadge"));

const controlsSource = await readFile(
  new URL("../app/(dashboard)/PipelineControls.tsx", import.meta.url),
  "utf8",
);
assert(controlsSource.includes("Tiếp tục pipeline"));
assert(controlsSource.includes("Tạo lô mới"));
assert(controlsSource.includes("Xác nhận tạo lô"));
assert(controlsSource.includes("confirmingBatch"));
assert(controlsSource.includes("newBatchPaused"));
assert(controlsSource.includes("P5: không có video đủ điều kiện."));
assert(controlsSource.includes("P6: chưa đủ batch analytics."));

const videoTableSource = await readFile(
  new URL("../app/(dashboard)/videos/VideosTable.tsx", import.meta.url),
  "utf8",
);
assert(videoTableSource.includes("cleanupWarnings"));
assert(videoTableSource.includes("Không thể xóa video đang render"));
assert(videoTableSource.includes("TtsStatusBadge"));

const attentionSource = await readFile(
  new URL("../app/(dashboard)/needs-attention/page.tsx", import.meta.url),
  "utf8",
);
assert(attentionSource.includes("Render lỗi terminal"));
assert(attentionSource.includes("Có audio nhưng thiếu text TTS"));
assert(attentionSource.includes("TTS thiếu voice mapping"));

console.log("UI/backend contract checks passed.");
