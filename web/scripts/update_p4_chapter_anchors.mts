import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { P4_TEMPLATE } from "./adaptive-prompts.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(scriptDirectory, "../.env.local") });

const { activateNewPromptVersion, getActivePromptVersion } = await import(
  "../lib/db/repo/prompt-versions.js"
);

const active = await getActivePromptVersion("P4");
if (active?.template === P4_TEMPLATE) {
  console.log(`P4 v${active.version} already has exact chapter anchors.`);
  process.exit(0);
}

const created = await activateNewPromptVersion({
  promptKey: "P4",
  template: P4_TEMPLATE,
  createdBy: "manual",
  changeReason:
    "Require exact 12-24 character narration anchors so render alignment can replace provisional P_desc chapters with real timestamps.",
});

console.log(`P4 v${created.version} activated (id=${created.id}).`);
