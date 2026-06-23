export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { getDrEpisode } = await import("../lib/db/repo/episodes");
  const e = await getDrEpisode(1);
  if (!e) return console.log("no episode");
  console.log("status:", e.status);
  console.log("scene:", JSON.stringify(e.sceneInput));
  console.log("ambient:", JSON.stringify(e.ambientSoundMap));
  const specs = (e.trackSpecs as Array<{ title: string; role: string; style_tags: string }>) ?? [];
  console.log("spec count:", specs.length);
  console.log("spec[0]:", JSON.stringify(specs[0]));
  console.log("style_tags len:", specs[0]?.style_tags?.length);
  console.log("roles:", [...new Set(specs.map((s) => s.role))].join(" | "));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
