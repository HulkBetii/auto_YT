import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const { buildVideoDescription } = await import("../lib/pipeline/descriptionBuilder.js");

const videoId = Number(process.argv[2] ?? 77);
const desc = await buildVideoDescription(videoId);
console.log(desc);
console.log(`\n[total ${desc.length} chars]`);
process.exit(0);
