/**
 * Code-based YouTube description assembler (no LLM call).
 * Runs after P_score passes → video becomes ready_to_publish.
 * Reads P2 / P3 / P4 outputs from video_content, queries related videos,
 * and formats the fixed description template.
 * Result is stored in video_content with stage = "P_desc".
 */
import { and, eq, isNotNull, ne, or } from "drizzle-orm";

import { db } from "../db";
import { videos } from "../db/schema";
import { getConfigValue } from "../db/repo/channel-config";
import { getLatestVideoContent, saveVideoContent } from "../db/repo/video-content";
import { getVideo } from "../db/repo/videos";

// ── Parsers ──────────────────────────────────────────────────────────────────

/** Extract 概要欄テキスト section from P4 output. */
function parseOverview(p4: string): { hook1: string; hook2: string; content: string } {
  const start = p4.indexOf("■ 概要欄テキスト");
  if (start === -1) return { hook1: "", hook2: "", content: "" };
  const rest = p4.slice(start + "■ 概要欄テキスト".length);
  const nextSection = rest.search(/\n■ /);
  const block = (nextSection === -1 ? rest : rest.slice(0, nextSection)).trim();

  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const hook1 = lines[0] ?? "";
  const hook2 = lines[1] ?? "";
  // Content = everything after hooks, excluding the disclaimer line
  const contentLines = lines
    .slice(2)
    .filter((l) => !l.startsWith("本動画は") && !l.startsWith("偉人たちの言葉"));
  return { hook1, hook2, content: contentLines.join("\n") };
}

/** Extract タグリスト from P4 output → "#tag1 #tag2 ..." */
function parseTags(p4: string): string {
  const start = p4.indexOf("■ タグリスト");
  if (start === -1) return "#哲人の刻 #名言 #偉人 #哲学 #人生論";
  const rest = p4.slice(start + "■ タグリスト".length);
  const nextSection = rest.search(/\n■ /);
  const block = (nextSection === -1 ? rest : rest.slice(0, nextSection));
  const tags = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("■") && !l.includes("（") && !l.startsWith("固定") && !l.startsWith("—"));
  return tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
}

/** Extract 固定コメント案 from P4 output. */
function parseFixedComment(p4: string): string {
  const start = p4.indexOf("■ 固定コメント案");
  if (start === -1) return "";
  const rest = p4.slice(start + "■ 固定コメント案".length);
  const nextSection = rest.search(/\n■ /);
  const block = (nextSection === -1 ? rest : rest.slice(0, nextSection)).trim();
  return block;
}

/** Extract チャプター設計 from P3 output. */
function parseChapters(p3: string): string {
  const idx = p3.indexOf("チャプター設計");
  if (idx === -1) return "00:00　[チャプター情報なし]";
  const block = p3.slice(idx + "チャプター設計".length).trim();
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    // Keep lines that start with a timestamp (00:00 or 0:00 pattern)
    .filter((l) => /^\d{1,2}:\d{2}/.test(l));
  if (lines.length === 0) return "00:00　[チャプター情報なし]";
  // Normalise full-width space → half-width space
  return lines.map((l) => l.replace(/　/g, " ")).join("\n");
}

// ── Related videos ────────────────────────────────────────────────────────────

async function getRelatedVideos(
  currentVideoId: number,
  featuredPerson: string | null,
  painType: string | null,
  limit = 3,
): Promise<Array<{ title: string; youtubeVideoId: string }>> {
  const conditions = [
    ne(videos.id, currentVideoId),
    isNotNull(videos.youtubeVideoId),
  ];
  if (featuredPerson || painType) {
    const orConditions = [];
    if (featuredPerson) orConditions.push(eq(videos.featuredPerson, featuredPerson));
    if (painType) orConditions.push(eq(videos.painType, painType));
    conditions.push(or(...orConditions)!);
  }
  return db
    .select({ title: videos.title, youtubeVideoId: videos.youtubeVideoId })
    .from(videos)
    .where(and(...conditions))
    .limit(limit) as Promise<Array<{ title: string; youtubeVideoId: string }>>;
}

// ── Main assembler ────────────────────────────────────────────────────────────

export async function buildVideoDescription(videoId: number): Promise<string> {
  const [video, p2Content, p3Content, p4Content, contactEmail] = await Promise.all([
    getVideo(videoId),
    getLatestVideoContent(videoId, "P2"),
    getLatestVideoContent(videoId, "P3"),
    getLatestVideoContent(videoId, "P4"),
    getConfigValue("contact_email"),
  ]);

  if (!video) throw new Error(`[desc] Video #${videoId} not found`);

  const p2 = p2Content?.output ?? "";
  const p3 = p3Content?.output ?? "";
  const p4 = p4Content?.output ?? "";

  const { hook1, hook2, content } = parseOverview(p4);
  const chapters = parseChapters(p3);
  const tags = parseTags(p4);
  const fixedComment = parseFixedComment(p4);
  const relatedVideos = await getRelatedVideos(
    videoId,
    video.featuredPerson,
    video.painType,
  );

  // ── Related videos section ─────────────────────────────────────────────────
  let relatedSection: string;
  if (relatedVideos.length >= 3) {
    relatedSection = relatedVideos
      .map((v) => `▶ https://www.youtube.com/watch?v=${v.youtubeVideoId}`)
      .join("\n");
  } else {
    relatedSection =
      "▶ [動画リンク1 — 公開後に追加]\n▶ [動画リンク2]\n▶ [動画リンク3]";
  }

  // ── Amazon placeholder ────────────────────────────────────────────────────
  const bookName = video.referenceBook ?? "[参考書籍]";
  const amazonLine = `${bookName} → amzn.to/[Amazonアフィリエイトリンクをここに追加]`;

  // ── Comment question (from P4 fixed comment, fallback to P2 S6) ───────────
  let commentQuestion = fixedComment;
  if (!commentQuestion && p2) {
    const s6idx = p2.indexOf("固定コメント案");
    if (s6idx !== -1) {
      commentQuestion = p2.slice(s6idx + "固定コメント案".length).split("■")[0].replace(/^[：:]\s*/, "").trim();
    }
  }
  if (!commentQuestion) commentQuestion = "[コメント用の問いかけ]";

  const email = contactEmail || "[your-email@gmail.com]";

  // ── Assemble ──────────────────────────────────────────────────────────────
  const desc = `${hook1}
${hook2}

━━━━━━━━━━━━━━━━━━━━━━━━
📌 この動画について
━━━━━━━━━━━━━━━━━━━━━━━━
${content}

━━━━━━━━━━━━━━━━━━━━━━━━
⏱ チャプター
━━━━━━━━━━━━━━━━━━━━━━━━
${chapters}

━━━━━━━━━━━━━━━━━━━━━━━━
🎬 おすすめの動画
━━━━━━━━━━━━━━━━━━━━━━━━
${relatedSection}

━━━━━━━━━━━━━━━━━━━━━━━━
📖 参考文献
━━━━━━━━━━━━━━━━━━━━━━━━
本動画は以下の書籍・資料を参考に制作した創作コンテンツです。
${amazonLine}

━━━━━━━━━━━━━━━━━━━━━━━━
💬 あなたへの問いかけ
━━━━━━━━━━━━━━━━━━━━━━━━
${commentQuestion}
コメント欄で、教えてくれ。

━━━━━━━━━━━━━━━━━━━━━━━━
🔔 チャンネル登録のお願い
━━━━━━━━━━━━━━━━━━━━━━━━
週3〜5本、偉人・哲人の言葉をお届けしています。
「チャンネル登録」と「🔔通知ベル」を押していただけると励みになります。

━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ 免責事項
━━━━━━━━━━━━━━━━━━━━━━━━
偉人たちの言葉と生き方を、現代に生きる日本人へ——それがこのチャンネルの願いです。
本動画は、実在の書籍・文献・歴史資料等を参考に、制作者の解釈に基づき再構成した創作コンテンツです。登場人物の発言や場面描写には、理解を深めるための演出（フィクション）が含まれており、歴史的事実を完全に再現したものではありません。音声はAI技術を使用しています。内容の誤りや不適切な表現がございましたら、下記までご連絡ください。
📧 ${email}

${tags}`.trim();

  return desc;
}

/**
 * Builds the description and saves it to video_content (stage = "P_desc").
 * Idempotent: if a P_desc row already exists it is overwritten via a new insert
 * (getLatestVideoContent always returns the most recent row).
 */
export async function generateAndSaveDescription(videoId: number): Promise<void> {
  const description = await buildVideoDescription(videoId);
  await saveVideoContent({
    videoId,
    stage: "P_desc",
    output: description,
  });
  console.log(`[desc] Video #${videoId} description saved (${description.length} chars)`);
}
