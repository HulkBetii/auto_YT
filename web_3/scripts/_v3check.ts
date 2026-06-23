export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });
async function main(){
  const { getDrEpisode } = await import("../lib/db/repo/episodes");
  const e = await getDrEpisode(2);
  console.log("harmonic_palette:", JSON.stringify(e?.harmonicPalette));
  const specs = (e?.trackSpecs as any[]) ?? [];
  console.log("spec count:", specs.length);
  console.log("D2A spec[0] style_tags:", specs[0]?.style_tags);
  console.log("D2B spec[5] style_tags:", specs[5]?.style_tags);
  const hp = e?.harmonicPalette as any;
  const key = (hp?.key_center||"").toLowerCase();
  const tagHasKey = (specs[0]?.style_tags||"").toLowerCase().includes(key.split(" ")[0]);
  console.log("key in style_tags?", tagHasKey, `(key="${hp?.key_center}")`);
  const bed = e?.ambientBedAudio as any;
  console.log("ambient_bed_audio:", bed ? `specIndex=${bed.specIndex} status=${bed.status} role=${bed.role}` : "MISSING");
  console.log("structure has signature timbre?", /Vibraphone|Arco|Bass Clarinet|Mellotron/.test(specs.map((s:any)=>s.structure).join(" ")));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
