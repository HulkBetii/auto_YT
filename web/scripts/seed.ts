import { config } from "dotenv";
config({ path: ".env.local" });

import type { promptVersions as PromptVersionsTable } from "../lib/db/schema";
import { ADAPTIVE_PROMPTS } from "./adaptive-prompts.js";

async function main() {
  const { db } = await import("../lib/db");
  const { channelConfig, promptVersions } = await import("../lib/db/schema");

  async function seedPrompt(
    promptKey: (typeof PromptVersionsTable.$inferInsert)["promptKey"],
    template: string,
  ) {
    await db
      .insert(promptVersions)
      .values({ promptKey, version: 1, template, isActive: true, createdBy: "manual" })
      .onConflictDoNothing();
  }

  await seedPrompt("P1", ADAPTIVE_PROMPTS.P1);
  await seedPrompt("P2", ADAPTIVE_PROMPTS.P2);
  await seedPrompt("P3", ADAPTIVE_PROMPTS.P3);
  await seedPrompt("P4", ADAPTIVE_PROMPTS.P4);
  await seedPrompt("P_score", ADAPTIVE_PROMPTS.P_score);
  await seedPrompt("P5", ADAPTIVE_PROMPTS.P5);
  await seedPrompt("P6", ADAPTIVE_PROMPTS.P6);

  await db
    .insert(channelConfig)
    .values([
      { key: "channel_name", value: "哲人の刻" },
      { key: "score_threshold", value: "80" },
      { key: "max_content_retries", value: "2" },
      { key: "rollback_threshold_pct", value: "25" },
      { key: "rollback_min_views", value: "100" },
      { key: "p1_topics_per_batch", value: "12" },
      { key: "p6_batch_size", value: "10" },
      { key: "anti_dup_fatigue_lookback", value: "12" },
      { key: "anti_dup_semantic_days", value: "90" },
      { key: "anti_dup_similarity_threshold", value: "85" },
    ])
    .onConflictDoNothing();

  console.log("Seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
