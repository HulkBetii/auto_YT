const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export function parseYouTubeUrl(value: string): { videoId: string; canonicalUrl: string } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Invalid YouTube URL.");
  }

  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase()) || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only youtube.com and youtu.be URLs are accepted.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const videoId =
    url.hostname.toLowerCase() === "youtu.be"
      ? parts[0]
      : url.searchParams.get("v") ??
        (["shorts", "embed", "live"].includes(parts[0] ?? "") ? parts[1] : null);

  if (!videoId || !YOUTUBE_ID_PATTERN.test(videoId)) {
    throw new Error("The URL does not contain a valid YouTube video ID.");
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
