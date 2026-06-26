import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const { getVideo, updateVideoStatus } = await import("../lib/db/repo/videos.js");
const { getLatestVideoContent } = await import("../lib/db/repo/video-content.js");
const { enqueueStage } = await import("../lib/pipeline/createJob.js");

const VIDEO_ID = 86;

const video = await getVideo(VIDEO_ID);
if (!video) { console.error("Video not found"); process.exit(1); }
console.log(`Video #${VIDEO_ID}: [${video.status}] ${video.featuredPerson} | ${video.title}`);

const p2 = await getLatestVideoContent(VIDEO_ID, "P2");
if (!p2) { console.error("No P2 content found"); process.exit(1); }
console.log(`P2 content: ${p2.output.length} chars`);

// Reset video status to scripted so the chain can progress normally
await updateVideoStatus(VIDEO_ID, "scripted");
console.log("Video status → scripted");

// Create a fresh P3 job (no causedByJobId → no idempotency check → new chain)
const job = await enqueueStage({
  promptKey: "P3",
  stage: "P3",
  videoId: VIDEO_ID,
  vars: {
    DANYI: p2.output,
    TEMP: String(video.temperature ?? ""),
    REFERENCE_BOOK: video.referenceBook ?? "",
    PERSON: video.featuredPerson ?? "",
  },
  // Deliberately omit causedByJobId so findJobByCause doesn't return the old P4 job
});

console.log(`New P3 job created: #${job.id} (pending) — worker will pick up within 15s`);
process.exit(0);
