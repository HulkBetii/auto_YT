import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { inArray } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

const { db } = await import("../lib/db/index.js");
const { videos, jobs, videoContent, videoAnalytics } = await import("../lib/db/schema/index.js");

// 15 newest video IDs to delete (keep #15–#19)
const IDS = [24, 25, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39];

console.log(`Deleting ${IDS.length} videos: #${IDS.join(", #")}`);

// Delete child records first (FK constraints)
const deletedAnalytics = await db.delete(videoAnalytics).where(inArray(videoAnalytics.videoId, IDS)).returning({ id: videoAnalytics.id });
console.log(`  ✓ video_analytics: ${deletedAnalytics.length} rows`);

const deletedContent = await db.delete(videoContent).where(inArray(videoContent.videoId, IDS)).returning({ id: videoContent.id });
console.log(`  ✓ video_content: ${deletedContent.length} rows`);

const deletedJobs = await db.delete(jobs).where(inArray(jobs.videoId, IDS)).returning({ id: jobs.id });
console.log(`  ✓ jobs: ${deletedJobs.length} rows`);

const deletedVideos = await db.delete(videos).where(inArray(videos.id, IDS)).returning({ id: videos.id });
console.log(`  ✓ videos: ${deletedVideos.length} rows`);

console.log("\nDone.");
process.exit(0);
