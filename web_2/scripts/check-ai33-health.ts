// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

async function main() {
  const apiKey = process.env.VIVOO_API_KEY;
  if (!apiKey) throw new Error("VIVOO_API_KEY env var is not set");

  const res = await fetch("https://api.ai33.pro/v1/health-check", {
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));

  const elevenlabs = json?.data?.elevenlabs;
  if (elevenlabs === "good") {
    console.log("\n✓ AI33 elevenlabs provider is healthy again — safe to use as primary TTS.");
  } else {
    console.log(`\n✗ AI33 elevenlabs provider is still "${elevenlabs}" — keep relying on Genmax fallback.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
