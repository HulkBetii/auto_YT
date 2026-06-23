export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

// Recover episode #1 after the 429 storm: tracks that already got a taskId are
// still generating on Suno's side → re-poll them (running); the rest → pending.
async function main() {
  const { getDrEpisode, updateDrEpisodeFields, updateDrEpisodeStatus, releaseEpisodeSunoLock } =
    await import("../lib/db/repo/episodes");
  const e = await getDrEpisode(1);
  const audio = (e?.audio as Array<{ taskId: string | null; status: string; errorMessage?: string; clips: unknown[] }>) ?? [];
  let running = 0;
  let pending = 0;
  for (const a of audio) {
    if (a.clips && a.clips.length > 0) continue; // already done
    if (a.taskId) { a.status = "running"; a.errorMessage = undefined; running++; }
    else { a.status = "pending"; a.errorMessage = undefined; pending++; }
  }
  await updateDrEpisodeFields(1, { audio });
  await releaseEpisodeSunoLock(1);
  await updateDrEpisodeStatus(1, "suno_pending");
  console.log(`reset: ${running} running (salvaged taskIds), ${pending} pending`);
  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });
