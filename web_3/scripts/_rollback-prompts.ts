export {};

// Rollback the v3 audio-update prompts: deactivate the current active version and
// reactivate v2 for each changed key. Usage: tsx scripts/_rollback-prompts.ts
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

const KEYS = ["D1", "D2A", "D2B", "D2C"];
const TARGET_VERSION = 2;

async function main() {
  const { db } = await import("../lib/db");
  const { sql } = await import("drizzle-orm");

  for (const key of KEYS) {
    await db.execute(
      sql`UPDATE dr_prompt_versions SET is_active = false WHERE prompt_key = ${key} AND is_active = true`,
    );
    const res = await db.execute(
      sql`UPDATE dr_prompt_versions SET is_active = true WHERE prompt_key = ${key} AND version = ${TARGET_VERSION}`,
    );
    console.log(`  ↩ ${key} → v${TARGET_VERSION} (rows: ${res.rowCount ?? "?"})`);
  }
  console.log("Rollback complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
