import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

async function main() {
  const { pool, db } = await import("../lib/db/index.js");
  const { koJpPromptVersions } = await import("../lib/db/schema.js");
  const { DEFAULT_PROMPT_TEMPLATES } = await import("../lib/pipeline/default-prompts.js");
  const { eq } = await import("drizzle-orm");

  console.log("Seeding default prompts for KO-JP pipeline...");

  const prompts = [
    { key: "source_audit", template: DEFAULT_PROMPT_TEMPLATES.source_audit },
    { key: "outline", template: DEFAULT_PROMPT_TEMPLATES.outline },
    { key: "script_section", template: DEFAULT_PROMPT_TEMPLATES.script_section },
    { key: "fidelity_review", template: DEFAULT_PROMPT_TEMPLATES.fidelity_review },
  ];

  for (const p of prompts) {
    const existing = await db
      .select()
      .from(koJpPromptVersions)
      .where(eq(koJpPromptVersions.promptKey, p.key))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(koJpPromptVersions).values({
        promptKey: p.key,
        version: 1,
        template: p.template,
        isActive: true,
        createdBy: "system_init",
        changeReason: "Initial seed",
      });
      console.log(`+ Seeded prompt: ${p.key} v1`);
    } else {
      console.log(`= Prompt already exists: ${p.key}`);
    }
  }

  console.log("Prompt seeding complete.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
