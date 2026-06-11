/**
 * Code-based YouTube description assembler (no LLM call).
 * Runs after P_score passes → video becomes ready_to_publish.
 * Reads P3 / P4 outputs from video_content, queries related videos,
 * and formats the fixed description template.
 * Result is stored in video_content with stage = "P_desc".
 */
import { and, eq, isNotNull, ne, or } from "drizzle-orm";

import { db } from "../db";
import { videos } from "../db/schema";
import { getConfigValue } from "../db/repo/channel-config";
import { getLatestVideoContent, saveVideoContent } from "../db/repo/video-content";
import { getVideo } from "../db/repo/videos";

// ── Section extractor ─────────────────────────────────────────────────────────

/**
 * Known P4 section header keywords.
 * ChatGPT may omit ■ and append漢数字 count suffixes — match by keyword prefix.
 */
const P4_SECTIONS = [
  "タイトル候補", "サムネイルテキスト", "概要欄テキスト", "タグリスト",
  "Shortsスクリプト", "コメント返信テンプレート", "投稿戦略", "チャプター設計",
  "固定コメント案", "SEO＋Shortsパッケージ",
];

function isSectionHeader(line: string): boolean {
  const stripped = line.trim().replace(/^■\s*/, "");
  return P4_SECTIONS.some(
    (sec) => stripped === sec || stripped.startsWith(sec + " ") || stripped.startsWith(sec + "（"),
  );
}

/**
 * Find a section by any of the given keywords and return its body text.
 * Handles headers with or without ■ and with漢数字 count suffixes.
 */
function extractSection(text: string, ...keywords: string[]): string {
  const lines = text.split("\n");
  let startLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim().replace(/^■\s*/, "");
    if (
      keywords.some(
        (kw) => stripped === kw || stripped.startsWith(kw + " ") || stripped.startsWith(kw + "（"),
      )
    ) {
      startLine = i;
      break;
    }
  }

  if (startLine === -1) return "";

  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (isSectionHeader(lines[i])) {
      endLine = i;
      break;
    }
  }

  return lines
    .slice(startLine + 1, endLine)
    .join("\n")
    .trim();
}

// ── Parsers ──────────────────────────────────────────────────────────────────

/** Extract 概要欄テキスト section from P4 output. */
function parseOverview(p4: string): { hook1: string; hook2: string; content: string } {
  const block = extractSection(p4, "概要欄テキスト");
  if (!block) return { hook1: "", hook2: "", content: "" };

  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const hook1 = lines[0] ?? "";
  const hook2 = lines[1] ?? "";
  const contentLines = lines
    .slice(2)
    .filter((l) => !l.startsWith("本動画は") && !l.startsWith("偉人たちの言葉"));
  return { hook1, hook2, content: contentLines.join("\n") };
}

/** Extract タグリスト from P4 output → "#tag1 #tag2 ..." */
function parseTags(p4: string): string {
  const block = extractSection(p4, "タグリスト");
  if (!block) return "#哲人の刻 #名言 #偉人 #哲学 #人生論";
  const tags = block
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("■") &&
        !l.includes("（") &&
        !l.startsWith("固定") &&
        !l.startsWith("—") &&
        !l.startsWith("Edit"),
    );
  if (tags.length === 0) return "#哲人の刻 #名言 #偉人 #哲学 #人生論";
  return tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
}

/**
 * Extract comment question: last question sentence from P3 narration.
 * Japanese questions end with ？ or the pattern〜か。/〜か？
 * Falls back to first content paragraph of コメント返信テンプレート from P4.
 */
function parseCommentQuestion(p3: string, p4: string): string {
  if (p3) {
    // Match sentences ending with ？/? or ending with か。(Japanese rhetorical question)
    const sentences = p3
      .split("\n")
      .map((s) => s.replace(/<#[\d.]+#>/g, "").trim())
      .filter((s) => s.endsWith("？") || s.endsWith("?") || /か[。。]$/.test(s));
    if (sentences.length > 0) {
      return sentences[sentences.length - 1];
    }
  }

  const block = extractSection(p4, "コメント返信テンプレート", "固定コメント案");
  if (block) {
    // Skip sub-section headers (e.g. "共感コメントへの返信") — look for first content line
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const contentLine = lines.find((l) => !l.endsWith("への返信") && !l.endsWith("テンプレート") && l.length > 15);
    if (contentLine) return contentLine;
  }

  return "[コメント用の問いかけ]";
}

/** Extract チャプター設計 from P4 output (chapters moved to P4 as of v3). */
function parseChapters(p4: string): string {
  const block = extractSection(p4, "チャプター設計");
  if (!block) return "00:00　[チャプター情報なし]";
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d{1,2}:\d{2}/.test(l));
  if (lines.length === 0) return "00:00　[チャプター情報なし]";
  return lines.join("\n");
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
  const [video, p3Content, p4Content, contactEmail] = await Promise.all([
    getVideo(videoId),
    getLatestVideoContent(videoId, "P3"),
    getLatestVideoContent(videoId, "P4"),
    getConfigValue("contact_email"),
  ]);

  if (!video) throw new Error(`[desc] Video #${videoId} not found`);

  const p3 = p3Content?.output ?? "";
  const p4 = p4Content?.output ?? "";

  const { hook1, hook2, content } = parseOverview(p4);
  const chapters = parseChapters(p4);
  const tags = parseTags(p4);
  const commentQuestion = parseCommentQuestion(p3, p4);
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
