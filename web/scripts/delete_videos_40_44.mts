/**
 * Deletes videos #40–44 (non-approved characters: 徳川家康, 坂本龍馬, 内村鑑三, 宮沢賢治, 兼好法師)
 * and all child records (video_analytics, video_content, jobs).
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

import { inArray } from "drizzle-orm";
const { db } = await import("../lib/db/index.js");
const { videos, videoContent, jobs, videoAnalytics } = await import("../lib/db/schema/index.js");

const IDS = [40, 41, 42, 43, 44];

console.log(`Deleting videos: ${IDS.join(", ")}`);

// Must delete in FK-dependency order (no transaction support on neon-http)
const analytics = await db.delete(videoAnalytics).where(inArray(videoAnalytics.videoId, IDS)).returning({ id: videoAnalytics.id });
const content   = await db.delete(videoContent).where(inArray(videoContent.videoId, IDS)).returning({ id: videoContent.id });
const jobRows   = await db.delete(jobs).where(inArray(jobs.videoId, IDS)).returning({ id: jobs.id });
const videoRows = await db.delete(videos).where(inArray(videos.id, IDS)).returning({ id: videos.id, title: videos.title, featuredPerson: videos.featuredPerson });

console.log(`  analytics rows deleted: ${analytics.length}`);
console.log(`  video_content rows deleted: ${content.length}`);
console.log(`  jobs rows deleted: ${jobRows.length}`);
console.log(`  videos deleted:`);
for (const v of videoRows) console.log(`    #${v.id} ${v.featuredPerson} — ${v.title?.slice(0, 50)}`);
console.log("\nDone.");
process.exit(0);
