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
  const { setAhConfigValue } = await import("../lib/db/repo/channel-config");

  const updaterPath = path.join(process.cwd(), "scripts", "update-prompts.ts");
  const updaterSource = readFileSync(updaterPath, "utf-8");
  const templates = {
    S1: extractTemplate(updaterSource, "S1_TEMPLATE"),
    S2: extractTemplate(updaterSource, "S2_TEMPLATE"),
    S3: extractTemplate(updaterSource, "S3_TEMPLATE"),
    S4: extractTemplate(updaterSource, "S4_TEMPLATE"),
  };

  console.log("Seeding prompt versions from scripts/update-prompts.ts...");

  for (const [promptKey, template] of Object.entries(templates)) {
    await insertAhPromptVersion({
      promptKey,
      template,
      changeReason: "initial seed from current prompt templates",
    });
    console.log(`  ✓ ${promptKey} prompt`);
  }

  console.log("\nSeeding channel config defaults...");
  await setAhConfigValue("voice_id", "");
  await setAhConfigValue("web2_url", process.env.WEB2_URL ?? "http://localhost:3001");
  console.log("  ✓ channel_config defaults");

  console.log("\nSeed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
