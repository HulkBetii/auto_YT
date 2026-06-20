export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

async function run() {
  const { getAhConfigValue } = await import("../lib/db/repo/channel-config");
  const voiceId = await getAhConfigValue("voice_id");
  const web2Url = await getAhConfigValue("web2_url");
  console.log("voice_id:", JSON.stringify(voiceId));
  console.log("web2_url:", JSON.stringify(web2Url));
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
