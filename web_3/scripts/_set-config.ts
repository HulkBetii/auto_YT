export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

async function main() {
  const { setDrConfigValue, getAllDrConfig } = await import("../lib/db/repo/channel-config");
  await setDrConfigValue("suno_paused", "true");
  await setDrConfigValue("target_scene_count", "5");
  console.log("config:", await getAllDrConfig());
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
