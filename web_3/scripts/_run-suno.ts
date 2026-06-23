export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

// Drives the Suno fan-out for the current suno_pending episode to completion
// (no dev server needed). Each loop does one batch op: submit up to 5 + poll all.
async function main() {
  const { setDrConfigValue } = await import("../lib/db/repo/channel-config");
  const { runSunoForPendingEpisode, describePendingSunoWait } = await import("../lib/pipeline/suno");
  const { getDrEpisode } = await import("../lib/db/repo/episodes");

  await setDrConfigValue("suno_paused", "false");
  console.log("suno_paused=false — starting fan-out");

  const MAX_ITERS = 80; // ~27 min at 20s/iter
  for (let i = 0; i < MAX_ITERS; i++) {
    const ep = await getDrEpisode(1);
    if (!ep || ep.status !== "suno_pending") {
      console.log(`episode #1 left suno_pending → status=${ep?.status}. Done.`);
      process.exit(0);
    }
    const ran = await runSunoForPendingEpisode();
    console.log(`[iter ${i}] ran=${ran} — ${await describePendingSunoWait()}`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
  console.log("max iters reached — check status manually");
  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });
