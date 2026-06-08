const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

export interface YoutubeVideoStats {
  views: number;
  likes: number | null;
  comments: number | null;
}

/**
 * Fetches view/like/comment counts via YouTube Data API v3 `videos.list` —
 * available with a plain API key (no OAuth). CTR and average-view-duration
 * require the YouTube Analytics API (channel-owner OAuth), which is out of
 * scope for a single API key; those two fields stay null here and are filled
 * manually via the dashboard (see the "Needs Attention → missing analytics"
 * queue in Phase 6 — this is an intentional, planned gap, not an oversight).
 */
export async function fetchVideoStatistics(youtubeVideoId: string): Promise<YoutubeVideoStats | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing YOUTUBE_API_KEY — required to poll video statistics.");
  }

  const url = new URL(`${YOUTUBE_API_BASE}/videos`);
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", youtubeVideoId);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`YouTube Data API error ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as {
    items?: Array<{ statistics?: Record<string, string> }>;
  };
  const stats = body.items?.[0]?.statistics;
  if (!stats) return null;

  return {
    views: Number.parseInt(stats.viewCount ?? "0", 10),
    likes: stats.likeCount ? Number.parseInt(stats.likeCount, 10) : null,
    comments: stats.commentCount ? Number.parseInt(stats.commentCount, 10) : null,
  };
}
