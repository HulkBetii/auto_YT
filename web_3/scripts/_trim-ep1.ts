export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

// Episode #1 was generated before the D2 batch cap existed: D2B over-produced
// (20 instead of 10) → 30 specs at layout [D2A 0..4][D2B 5..24][D2C 25..29].
// Rebuild the intended 20 = first 5 + D2B first 10 + D2C 5, then re-init audio.
async function main() {
  const { getDrEpisode, updateDrEpisodeFields } = await import("../lib/db/repo/episodes");
  type Spec = { title: string; role: string };
  const e = await getDrEpisode(1);
  if (!e) throw new Error("episode #1 not found");
  const specs = (e.trackSpecs as Spec[]) ?? [];
  if (specs.length !== 30) {
    console.log(`spec count is ${specs.length}, expected 30 — aborting to avoid wrong trim`);
    process.exit(0);
  }
  const trimmed = [...specs.slice(0, 5), ...specs.slice(5, 15), ...specs.slice(25, 30)];
  const audio = trimmed.map((s, i) => ({
    specIndex: i,
    title: s.title,
    role: s.role,
    taskId: null,
    status: "pending" as const,
    clips: [],
  }));
  await updateDrEpisodeFields(1, { trackSpecs: trimmed, audio });
  console.log(`trimmed to ${trimmed.length} specs; roles:`, trimmed.map((s) => s.role[0]).join(""));
  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });
