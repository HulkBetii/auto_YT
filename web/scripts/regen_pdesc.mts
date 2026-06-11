import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const { generateAndSaveDescription } = await import("../lib/pipeline/descriptionBuilder.js");

const videoId = Number(process.argv[2] ?? 77);
await generateAndSaveDescription(videoId);
console.log(`Done: P_desc saved for video #${videoId}`);
process.exit(0);
