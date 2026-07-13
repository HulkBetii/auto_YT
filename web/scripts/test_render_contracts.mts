import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  getRenderedChaptersPath,
  getRenderedSubtitlePath,
  getRenderDirectory,
  parseByteRange,
} from "../lib/render/files.js";
import { stripChapterAnchor } from "../lib/render/chapters.js";
import {
  buildRenderQueueReset,
  MAX_RENDER_ATTEMPTS,
  parseRenderAction,
  shouldResetRenderForAudio,
} from "../lib/render/state.js";
import { SETTINGS_FIELDS } from "../lib/settings/fields.js";

assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
assert.deepEqual(parseByteRange("bytes=500-", 1000), { start: 500, end: 999 });
assert.deepEqual(parseByteRange("bytes=-200", 1000), { start: 800, end: 999 });
assert.equal(parseByteRange("bytes=-0", 1000), null);
assert.equal(parseByteRange("bytes=1000-", 1000), null);
assert.equal(parseByteRange("bytes=2-1", 1000), null);

assert.throws(() => getRenderDirectory(-1), /Invalid video id/);
const renderDirectory = getRenderDirectory(2);
assert.equal(path.basename(renderDirectory), "2");
assert(renderDirectory.includes(path.join("data", "renders")));
assert.equal(path.basename(getRenderedSubtitlePath(2)), "subtitles.srt");
assert.equal(path.basename(getRenderedChaptersPath(2)), "chapters.json");
assert.throws(() => getRenderedSubtitlePath(0), /Invalid video id/);
assert.equal(
  stripChapterAnchor(
    "01:20　心を整える　｜　ANCHOR: 心を静かに整えていきます",
  ),
  "01:20　心を整える",
);

assert.equal(parseRenderAction({ action: "retry" }), "retry");
assert.equal(parseRenderAction({ action: "rerender" }), "rerender");
assert.equal(parseRenderAction({ action: "delete" }), null);
assert.equal(parseRenderAction(null), null);

assert.equal(MAX_RENDER_ATTEMPTS, 4);
const requestedAt = new Date("2026-07-13T00:00:00Z");
assert.deepEqual(buildRenderQueueReset(requestedAt), {
  renderStatus: "not_started",
  renderError: null,
  renderAttemptCount: 0,
  renderNextAttemptAt: null,
  renderRequestedAt: requestedAt,
  renderStartedAt: null,
  renderFinishedAt: null,
  renderHeartbeatAt: null,
  renderWorkerToken: null,
});
assert.equal(shouldResetRenderForAudio("old", "new"), true);
assert.equal(shouldResetRenderForAudio("same", "same"), false);

const settings = new Map(SETTINGS_FIELDS.map((field) => [field.key, field]));
assert(settings.get("render_seconds_per_image")?.schema.safeParse("30").success);
assert(!settings.get("render_seconds_per_image")?.schema.safeParse("4").success);
assert(settings.get("render_crossfade_seconds")?.schema.safeParse("0.5").success);
assert(!settings.get("render_crossfade_seconds")?.schema.safeParse("3.1").success);

const repoSource = await readFile(
  new URL("../lib/db/repo/videos.ts", import.meta.url),
  "utf8",
);
assert(repoSource.includes(".set({ ttsTaskId: taskId, ttsText"));
assert(repoSource.includes("shouldResetRenderForAudio"));
assert(!repoSource.includes("videoPath: null"));

const fileRouteSource = await readFile(
  new URL("../app/api/videos/[id]/render/file/route.ts", import.meta.url),
  "utf8",
);
assert(fileRouteSource.includes("getRenderedVideoPath(videoId)"));
assert(!fileRouteSource.includes("stat(video.videoPath"));

const subtitleRouteSource = await readFile(
  new URL("../app/api/videos/[id]/render/subtitles/route.ts", import.meta.url),
  "utf8",
);
assert(subtitleRouteSource.includes("getRenderedSubtitlePath(videoId)"));
assert(
  subtitleRouteSource.includes(
    '"Content-Type": "application/x-subrip; charset=utf-8"',
  ),
);
assert(subtitleRouteSource.includes('filename="video-${videoId}.srt"'));

const statusRouteSource = await readFile(
  new URL("../app/api/videos/[id]/render/status/route.ts", import.meta.url),
  "utf8",
);
assert(statusRouteSource.includes("subtitleAvailable"));
assert(statusRouteSource.includes("renderedSubtitleExists(videoId)"));

const descriptionBuilderSource = await readFile(
  new URL("../lib/pipeline/descriptionBuilder.ts", import.meta.url),
  "utf8",
);
assert(descriptionBuilderSource.includes(".map(stripChapterAnchor)"));
assert(descriptionBuilderSource.includes("resolvedChapters ?? parseChapters(p4)"));
assert(descriptionBuilderSource.includes('video.renderStatus === "done"'));
assert(descriptionBuilderSource.includes("video.audioUrl === video.renderedAudioUrl"));

const renderPanelSource = await readFile(
  new URL("../app/(dashboard)/videos/[id]/RenderPanel.tsx", import.meta.url),
  "utf8",
);
assert(renderPanelSource.includes("snapshot.subtitleAvailable"));
assert(renderPanelSource.includes("Tải SRT"));

const videoTableSource = await readFile(
  new URL("../app/(dashboard)/videos/VideosTable.tsx", import.meta.url),
  "utf8",
);
assert(videoTableSource.includes("video.subtitleAvailable"));
assert(videoTableSource.includes("/render/subtitles"));

const deleteRouteSource = await readFile(
  new URL("../app/api/videos/bulk-delete/route.ts", import.meta.url),
  "utf8",
);
assert(deleteRouteSource.includes('.for("update")'));
assert(deleteRouteSource.includes("removeRenderArtifacts"));

const actionRouteSource = await readFile(
  new URL("../app/api/videos/[id]/render/route.ts", import.meta.url),
  "utf8",
);
assert(actionRouteSource.includes('.for("update")'));

console.log("Render contract checks passed.");
