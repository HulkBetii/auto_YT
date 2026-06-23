export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { getDrEpisode } = await import("../lib/db/repo/episodes");
  const e = await getDrEpisode(1);
  const a = (e?.audio as Array<{ specIndex: number; status: string; taskId: string | null }>).find((x) => x.status === "running");
  if (!a) { console.log("no running track"); process.exit(0); }
  console.log("running track:", a.specIndex, "taskId:", a.taskId);
  const r = await fetch(`https://api.ai33.pro/v1/task/${a.taskId}`, { headers: { "xi-api-key": process.env.SUNO_API_KEY! } });
  const j = (await r.json()) as { status?: string; progress?: number; error_message?: string };
  console.log("http:", r.status, "status:", j.status, "progress:", j.progress, "err:", j.error_message);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
