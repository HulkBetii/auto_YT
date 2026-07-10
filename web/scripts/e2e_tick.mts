import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const { maybeStartNewBatch } = await import("../lib/pipeline/batch.js");
const { runChainCycle } = await import("../lib/pipeline/chain.js");
const { refreshAnalyticsAndTriggerP5, triggerP6IfBatchReady } = await import("../lib/pipeline/analyticsCheck.js");
const { runTTSForReadyVideos } = await import("../lib/pipeline/tts.js");

const chain = await runChainCycle();
const newBatch = await maybeStartNewBatch();
const tts = await runTTSForReadyVideos();
const p5Triggered = await refreshAnalyticsAndTriggerP5();
const p6Batch = await triggerP6IfBatchReady();

console.log(JSON.stringify({ chain, newBatch, tts, p5Triggered, p6Batch }, null, 2));
process.exit(0);
