import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

import { desc } from "drizzle-orm";
const { db } = await import("../lib/db/index.js");
const { videos } = await import("../lib/db/schema/index.js");

const rows = await db
  .select({ id: videos.id, title: videos.title, status: videos.status, featuredPerson: videos.featuredPerson, createdAt: videos.createdAt })
  .from(videos)
  .orderBy(desc(videos.createdAt))
  .limit(10);

for (const r of rows)
  console.log(`#${r.id}  [${r.status}]  ${r.featuredPerson ?? "?"}  ${r.title?.slice(0, 50)}`);
process.exit(0);
