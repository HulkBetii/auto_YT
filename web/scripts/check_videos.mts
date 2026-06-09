import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

const { db } = await import("../lib/db/index.js");
const { videos } = await import("../lib/db/schema/index.js");

const all = await db.select().from(videos).orderBy(videos.id as never);
for (const v of all) {
  const audio = v.audioUrl ? "🔊 YES" : "   null";
  const yt = v.youtubeVideoId ? `yt=${v.youtubeVideoId}` : "yt=null";
  console.log(`#${v.id} [${v.status.padEnd(18)}] ${audio} ${yt} person=${v.featuredPerson ?? "?"}`);
}
process.exit(0);
