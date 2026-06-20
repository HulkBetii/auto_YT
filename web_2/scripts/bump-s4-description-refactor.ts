// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import path from "node:path";

function extractTemplate(source: string, name: string): string {
  const marker = `const ${name} = \``;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Template ${name} not found in scripts/update-prompts.ts`);
  }

  const bodyStart = start + marker.length;
  let escaped = false;
  for (let i = bodyStart; i < source.length; i++) {
    const char = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "`") {
      return source.slice(bodyStart, i);
    }
  }

  throw new Error(`Template ${name} is not terminated`);
}

async function main() {
  const { insertAhPromptVersion } = await import("../lib/db/repo/prompt-versions");

  const updaterPath = path.join(process.cwd(), "scripts", "update-prompts.ts");
  const updaterSource = readFileSync(updaterPath, "utf-8");
  const template = extractTemplate(updaterSource, "S4_TEMPLATE");

  const created = await insertAhPromptVersion({
    promptKey: "S4",
    template,
    changeReason: "S4 outputs variable JSON only; description assembled in code with real chapters + config URLs",
  });

  console.log(`✓ S4 prompt bumped to version ${created.version} (id=${created.id})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
