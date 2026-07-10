import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { ADAPTIVE_PROMPTS } from "./adaptive-prompts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const { activateNewPromptVersion } = await import("../lib/db/repo/prompt-versions.js");

const CHANGE_REASON =
  "Fixed persona adaptive pipeline: 美輪明宏-only channel identity with 6 archetypes, 4 persona modes, adaptive SEO/scoring, analytics metadata, and no persona rotation.";

for (const [promptKey, template] of Object.entries(ADAPTIVE_PROMPTS)) {
  const created = await activateNewPromptVersion({
    promptKey: promptKey as keyof typeof ADAPTIVE_PROMPTS,
    template,
    createdBy: "manual",
    changeReason: CHANGE_REASON,
  });
  console.log(`✓ ${promptKey} v${created.version} activated (id=${created.id})`);
}

process.exit(0);
