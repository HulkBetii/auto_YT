/**
 * Monitor P3 v10 twist rule compliance via P_score v2 emotion breakdown.
 *
 * A video "passes" the twist check if breakdown.emotion == 30 (all B criteria full).
 * If emotion < 30 AND issues mention twist/ツイスト/転換/視点, that's a signal the
 * rule in S3 is being ignored — consider moving it to 【出力ルール】.
 *
 * Run after a few videos complete the P3 v10 → P_score v2 path.
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

// Find videos where the P3 job used any prompt version containing the twist rule —
// matches by template content so future versions (v11, v12...) are covered automatically.
const TWIST_MARKER = "視点の反転";
const rows = await sql`
  SELECT
    v.id, v.title, v.score,
    j_p3.prompt_version_id  AS p3_pv,
    j_score.prompt_version_id AS pscore_pv,
    pv_p3.version           AS p3_version,
    pv_score.version        AS pscore_version,
    vc_score.output         AS pscore_raw
  FROM videos v
  JOIN jobs j_p3
    ON j_p3.video_id = v.id AND j_p3.stage = 'P3'
    AND j_p3.status = 'done'
  JOIN prompt_versions pv_p3
    ON pv_p3.id = j_p3.prompt_version_id
    AND pv_p3.template LIKE ${"%" + TWIST_MARKER + "%"}
  LEFT JOIN jobs j_score
    ON j_score.video_id = v.id AND j_score.stage = 'P_score'
    AND j_score.status = 'done'
  LEFT JOIN prompt_versions pv_score ON pv_score.id = j_score.prompt_version_id
  LEFT JOIN video_content vc_score
    ON vc_score.video_id = v.id AND vc_score.stage = 'P_score'
  ORDER BY v.id, vc_score.id DESC
`;

// Dedupe to latest P_score per video
const seen = new Set<number>();
let totalVideos = 0;
let twistPassCount = 0;

for (const r of rows) {
  if (seen.has(r.id)) continue;
  seen.add(r.id);
  totalVideos++;

  if (!r.pscore_raw) {
    console.log(`#${r.id} [P3 v${r.p3_version}] — P_score chưa có`);
    continue;
  }

  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(r.pscore_raw); } catch { /* raw text */ }

  const breakdown = (parsed.breakdown ?? {}) as Record<string, number>;
  const issues = (parsed.issues ?? []) as string[];
  const emotionScore: number = breakdown.emotion ?? -1;
  const twistFailed = emotionScore < 30 &&
    issues.some(i => /ツイスト|転換|視点|反転|twist/i.test(i));

  if (emotionScore === 30) twistPassCount++;

  const flag = emotionScore === 30 ? "✅" : twistFailed ? "❌ twist issue" : "⚠️ emotion low";
  console.log(
    `#${r.id} [P3 v${r.p3_version} + P_score v${r.pscore_version}] ` +
    `total=${r.score} | emotion=${emotionScore}/30 ${flag}`
  );
  if (issues.length && emotionScore < 30) {
    console.log(`   issues: ${issues.join("; ").slice(0, 160)}`);
  }
}

console.log(`\n--- Summary: ${totalVideos} videos through P3 v10 ---`);
if (totalVideos > 0) {
  console.log(`Emotion 30/30 (twist likely ok): ${twistPassCount}/${totalVideos}`);
  if (twistPassCount / totalVideos < 0.6) {
    console.log("⚠️  SIGNAL: twist rule compliance < 60% → consider moving 視点の反転 to 【出力ルール】");
  }
} else {
  console.log("No P3 v10 videos scored yet — run again after next pipeline cycle.");
}
process.exit(0);
