import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { inArray, eq } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

const { db } = await import("../lib/db/index.js");
const { videos, jobs, videoContent, videoAnalytics } = await import("../lib/db/schema/index.js");

const IDS = [18];
const d1 = await db.delete(videoAnalytics).where(inArray(videoAnalytics.videoId, IDS)).returning({ id: videoAnalytics.id });
const d2 = await db.delete(videoContent).where(inArray(videoContent.videoId, IDS)).returning({ id: videoContent.id });
const d3 = await db.delete(jobs).where(inArray(jobs.videoId, IDS)).returning({ id: jobs.id });
const d4 = await db.delete(videos).where(inArray(videos.id, IDS)).returning({ id: videos.id });
console.log(`Deleted #18: analytics=${d1.length}, content=${d2.length}, jobs=${d3.length}, video=${d4.length}`);
process.exit(0);
