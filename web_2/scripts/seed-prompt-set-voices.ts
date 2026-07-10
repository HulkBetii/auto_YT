import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { setAhConfigValue } = await import("@/lib/db/repo/channel-config");
  const { AH_CONFIG_KEYS } = await import("@/lib/db/schema");

  const promptSetVoices = [
    [AH_CONFIG_KEYS.voiceIdMackYt, "elevenlabs_JBFqnCBsd6RMkjVDRZzb"],
    [AH_CONFIG_KEYS.voiceIdSticklyYt, "elevenlabs_iP95p4xoKVk53GoZ742B"],
    [AH_CONFIG_KEYS.voiceIdExplainInPaintYt, "elevenlabs_mksYbFDhHsciAVdAPydq"],
  ] as const;

  for (const [key, voiceId] of promptSetVoices) {
    await setAhConfigValue(key, voiceId);
    console.log(`${key}=${voiceId}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
