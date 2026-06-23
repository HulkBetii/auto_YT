export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });

const SPEC = {
  title: "Rain on Empty Stairs",
  role: "Short Noir Intro",
  youtube_use_case: "Rainy Night",
  style_tags:
    "dark jazz, noir jazz, smoky tenor saxophone, muted trumpet, upright bass, brushed drums, sparse noir piano, tape hiss, vinyl crackle, rain on concrete, red neon buzz, 62 BPM, Instrumental only, No vocals, No lyrics, Human feel, High fidelity, Masterpiece",
  structure:
    "[Instrumental Only][No Vocals][No Lyrics][No Spoken Word]\n[Short Intro]\n[SFX: rain on concrete stairs]\n[SFX: red neon transformer buzz]\n[Noir Piano Entrance]\n[Upright Bass Pulse]\n[Muted Trumpet Motif]\n[Breathy Sax Phrase]\n[Soft Brush Drums]\n[Fade Out into basement hush]",
  mix_notes: "rain bed low under sax; bass forward; brushes intimate",
  transition_note: "fade tail into next intro",
};

async function main() {
  const { submitSuno, checkSuno } = await import("../lib/pipeline/suno");
  console.log("Submitting one Suno generation (custom mode)...");
  const taskId = await submitSuno(SPEC, process.env.SUNO_MODEL_VERSION || "v4.5-all");
  console.log("task_id:", taskId);

  const start = Date.now();
  const MAX_MS = 5 * 60 * 1000;
  while (Date.now() - start < MAX_MS) {
    await new Promise((r) => setTimeout(r, 10_000));
    const res = await checkSuno(taskId);
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`[${elapsed}s] status=${res.status}${res.message ? " — " + res.message : ""}`);
    if (res.status === "done") {
      console.log("CLIPS:", JSON.stringify(res.clips, null, 2));
      console.log(`clip count: ${res.clips?.length}; durations(s): ${res.clips?.map((c) => c.durationSec).join(", ")}`);
      process.exit(0);
    }
    if (res.status === "error") {
      console.error("FAILED:", res.message);
      process.exit(1);
    }
  }
  console.error("Timed out after 5 min — task may still be processing:", taskId);
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
