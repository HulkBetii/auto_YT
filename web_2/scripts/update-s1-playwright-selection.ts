// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import path from "node:path";

const PROMPT_SOURCES = [
  { promptSetVersion: "2.1-Mack-YT", file: "update-prompts.ts" },
  { promptSetVersion: "2.2-Stickly-YT", file: "update-stickly-prompts.ts" },
  { promptSetVersion: "2.3-Explain-In-Paint-YT", file: "update-explain-in-paint-prompts.ts" },
] as const;

function extractTemplate(source: string, name: string): string {
  const marker = `const ${name} = \``;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Template ${name} not found.`);

  const bodyStart = start + marker.length;
  let escaped = false;
  for (let index = bodyStart; index < source.length; index++) {
    const char = source[index];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "`") {
      return source.slice(bodyStart, index);
    }
  }
  throw new Error(`Template ${name} is not terminated.`);
}

async function main() {
  const { insertAhPromptVersion } = await import("../lib/db/repo/prompt-versions");

  for (const sourceConfig of PROMPT_SOURCES) {
    const sourcePath = path.join(process.cwd(), "scripts", sourceConfig.file);
    const template = extractTemplate(readFileSync(sourcePath, "utf-8"), "S1_TEMPLATE");
    const created = await insertAhPromptVersion({
      promptKey: "S1",
      promptSetVersion: sourceConfig.promptSetVersion,
      template,
      createdBy: "script",
      changeReason: "Playwright-first S1 selection with recommended_index",
    });
    console.log(`${sourceConfig.promptSetVersion}: S1 v${created.version}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
