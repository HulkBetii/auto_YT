export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { getDrEpisode } = await import("../lib/db/repo/episodes");
  const e = await getDrEpisode(1);
  const audio = (e?.audio as Array<{ specIndex: number; status: string; taskId: string | null; errorMessage?: string; clips: unknown[] }>) ?? [];
  const byStatus: Record<string, number> = {};
  for (const a of audio) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  console.log("episode status:", e?.status);
  console.log("audio by status:", byStatus);
  for (const a of audio.filter((x) => x.status === "error").slice(0, 3)) {
    console.log(`  track#${a.specIndex} taskId=${a.taskId} err=${a.errorMessage}`);
  }
  const done = audio.filter((a) => a.status === "done");
  console.log(`done tracks: ${done.length}; sample clips:`, JSON.stringify(done[0]?.clips ?? []));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
