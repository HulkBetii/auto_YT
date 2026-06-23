export {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local" });
async function main(){
  const { getDrEpisode } = await import("../lib/db/repo/episodes");
  const e = await getDrEpisode(1);
  const ch = (e?.ytChapters as any[]) ?? [];
  const thumb = e?.thumbnail as any;
  console.log("title:", e?.ytTitle);
  console.log("slug:", e?.ytSlug);
  console.log("chapters:", ch.length, "| first 3:", ch.slice(0,3).map((c:any)=>`${c.time} ${c.title}`).join(" / "));
  console.log("last chapter:", ch[ch.length-1]?.time, ch[ch.length-1]?.title);
  console.log("tags len:", (e?.ytTags??"").length, "| pinned?", !!e?.ytPinnedComment, "| playlists:", (e?.ytPlaylists as any[])?.length);
  console.log("thumbnail prompt?", !!thumb?.nano_banana_prompt, "(", (thumb?.nano_banana_prompt??"").length, "chars )");
  console.log("--- description (first 600) ---\n" + (e?.ytDescription??"").slice(0,600));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
