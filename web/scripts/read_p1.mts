import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

const { getActivePromptVersion } = await import("../lib/db/repo/prompt-versions.js");

const row = await getActivePromptVersion("P1");
if (!row) {
  console.log("No active P1 prompt found.");
} else {
  console.log(`=== P1 v${row.version} (id=${row.id}) ===`);
  console.log(row.template);
}
process.exit(0);
