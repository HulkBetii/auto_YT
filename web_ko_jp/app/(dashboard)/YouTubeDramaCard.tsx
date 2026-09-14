"use client";

import React, { useState } from "react";

interface YouTubePackageResult {
  videoId?: number;
  title: string;
  url: string;
  conversationUrl?: string;
  titleJp: string;
  scriptJp: string;
  descriptionJp: string;
  thumbnailText: string;
  thumbnailOptions?: string[];
  thumbnailImageUrl?: string | null;
  audioUrl?: string | null;
  charCount: number;
}

export function YouTubeDramaCard() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Auto create image & auto TTS toggles
  const [autoCreateImage, setAutoCreateImage] = useState(true);
  const [autoSynthesizeAudio, setAutoSynthesizeAudio] = useState(false);

  // Result state
  const [result, setResult] = useState<YouTubePackageResult | null>(null);
  const [selectedThumb, setSelectedThumb] = useState<string>("");

  // TTS state
  const [ttsLoading, setTtsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);

  // Copy feedbacks
  const [copiedType, setCopiedType] = useState<string | null>(null);

  // Prompt preview toggle
  const [showPromptPreview, setShowPromptPreview] = useState(false);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    setAudioUrl(null);
    setTtsError(null);
    setStep("Turn 1/5: Bóc tách transcript và viết kịch bản tiếng Nhật (Thinking: High)...");

    try {
      const t1 = setTimeout(() => {
        setStep("Turn 2/5: Viết tiêu đề 【99％が知らない】 chuẩn SEO Nhật Bản...");
      }, 35000);
      const t2 = setTimeout(() => {
        setStep("Turn 3/5: Viết mô tả chuẩn SEO & 3 #tag trong cùng phiên chat...");
      }, 55000);
      const t3 = setTimeout(() => {
        setStep("Turn 4/5: Đề xuất & chốt text Thumbnail 3 dòng gay gắt...");
      }, 75000);
      const t4 = setTimeout(() => {
        if (autoCreateImage) {
          setStep("Turn 5/5: Upload phoi-ko-jp.png & Tạo ảnh Thumbnail hoàn chỉnh (@Create image)...");
        }
      }, 95000);

      const res = await fetch("/api/youtube-rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          action: "generate",
          generateImage: autoCreateImage,
        }),
      });

      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Quá trình chuyển thể thất bại.");
      }

      setStep("Hoàn tất trọn bộ 5 Turns!");
      setResult(json.data);
      setSelectedThumb(json.data.thumbnailText || "");
      if (json.data.audioUrl) {
        setAudioUrl(json.data.audioUrl);
      } else if (autoSynthesizeAudio && json.data.scriptJp) {
        setStep("Đang tự động sinh giọng Audio Drama (GPT-SoVITS Konosuke Matsushita)...");
        try {
          const ttsRes = await fetch("/api/tts-drama", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: json.data.scriptJp,
              videoId: json.data.videoId,
              speed: 0.95,
            }),
          });
          const ttsJson = await ttsRes.json();
          if (ttsJson.ok && ttsJson.audioUrl) {
            setAudioUrl(ttsJson.audioUrl);
            setStep("Hoàn tất toàn bộ: 5 Turns + Audio Drama!");
          }
        } catch (ttsErr) {
          console.warn("Auto TTS failed:", ttsErr);
        }
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSynthesizeDramaAudio() {
    if (!result?.scriptJp) return;
    setTtsLoading(true);
    setTtsError(null);

    try {
      const res = await fetch("/api/tts-drama", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: result.scriptJp,
          videoId: result.videoId,
          speed: 0.95,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Không thể sinh giọng audio.");
      }

      setAudioUrl(json.audioUrl);
    } catch (err: any) {
      setTtsError(err.message || String(err));
    } finally {
      setTtsLoading(false);
    }
  }

  function copyToClipboard(text: string, type: string) {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  }

  function handleCopyAll() {
    if (!result) return;
    const allText = `【TIÊU ĐỀ】\n${result.titleJp}\n\n【TEXT THUMBNAIL (3 DÒNG)】\n${selectedThumb}\n\n【MÔ TẢ & HASHTAG】\n${result.descriptionJp}\n\n【KỊCH BẢN TIẾNG NHẬT】\n${result.scriptJp}`;
    copyToClipboard(allText, "all");
  }

  function handleDownloadTxt() {
    if (!result) return;
    const allText = `Title (JP):\n${result.titleJp}\n\nThumbnail Text:\n${selectedThumb}\n\nDescription & Tags:\n${result.descriptionJp}\n\nScript (JP):\n${result.scriptJp}`;
    const blob = new Blob([allText], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `youtube_package_jp_${Date.now()}.txt`;
    link.click();
  }

  const thumbLines = selectedThumb ? selectedThumb.split("\n").filter((l) => l.trim()) : [];

  return (
    <div className="panel-card border-2 border-[#26D9FF]/40 bg-[#141C24] p-5 shadow-2xl relative overflow-hidden space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#344254]">
        <div className="flex items-center gap-3">
          <span className="flex h-3 w-3 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#26D9FF] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#26D9FF]"></span>
          </span>
          <div>
            <h2 className="text-lg font-bold text-[#F7FAFF] tracking-wide flex items-center gap-2">
              YouTube ➔ Trọn Bộ Gói Nội Dung Nhật Bản (Kịch Bản • Tiêu Đề • Mô Tả • Thumbnail)
            </h2>
            <p className="text-xs text-[#95A3B5]">
              Chuỗi 5 Turns trong cùng 1 phiên chat: Kịch bản ➔ Tiêu đề ➔ Mô tả ➔ Text Thumb ➔ Tạo Ảnh Thumbnail @Create image
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded bg-[#26D9FF]/10 text-[#26D9FF] border border-[#26D9FF]/30 font-semibold mono">
            Single Chat Session
          </span>
          <span className="text-xs px-2.5 py-1 rounded bg-[#F7C948]/10 text-[#F7C948] border border-[#F7C948]/30 font-semibold mono">
            Thinking: High
          </span>
          <span className="text-xs px-2.5 py-1 rounded bg-[#FF5C7A]/10 text-[#FF5C7A] border border-[#FF5C7A]/30 font-semibold mono">
            @Create image
          </span>
        </div>
      </div>

      {/* Input Form */}
      <form onSubmit={handleGenerate} className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Dán link video YouTube tại đây (vd: https://www.youtube.com/watch?v=XOLQg00NhAw)..."
            required
            disabled={loading}
            className="flex-1 px-4 py-3 bg-[#0B0F14] border border-[#344254] focus:border-[#26D9FF] rounded-lg text-sm text-[#F7FAFF] placeholder-[#64748B] outline-none transition-all"
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className={`px-6 py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 shrink-0 ${
              loading
                ? "bg-[#344254] text-[#95A3B5] cursor-not-allowed"
                : "bg-gradient-to-r from-[#26D9FF] via-[#00A3FF] to-[#7B2CBF] text-[#FFFFFF] hover:shadow-[0_0_20px_rgba(38,217,255,0.4)] cursor-pointer"
            }`}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-[#95A3B5]" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                <span>Đang xử lý 5 Turns...</span>
              </>
            ) : (
              <span>⚡ Tạo Trọn Bộ Nội Dung + Ảnh Thumbnail</span>
            )}
          </button>
        </div>

        {/* Options Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-[#C3CEDB] cursor-pointer">
              <input
                type="checkbox"
                checked={autoCreateImage}
                onChange={(e) => setAutoCreateImage(e.target.checked)}
                className="accent-[#26D9FF] w-4 h-4 rounded"
              />
              <span>Tự động tạo ảnh Thumbnail hoàn chỉnh ở Turn 5 (@Create image với phoi-ko-jp.png)</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-[#26D9FF] cursor-pointer">
              <input
                type="checkbox"
                checked={autoSynthesizeAudio}
                onChange={(e) => setAutoSynthesizeAudio(e.target.checked)}
                className="accent-[#26D9FF] w-4 h-4 rounded"
              />
              <span>Tự động sinh Audio lồng tiếng toàn bộ kịch bản (GPT-SoVITS Konosuke Drama)</span>
            </label>
          </div>

          <button
            type="button"
            onClick={() => setShowPromptPreview(!showPromptPreview)}
            className="text-xs text-[#95A3B5] hover:text-[#26D9FF] transition-colors flex items-center gap-1 cursor-pointer"
          >
            <span>{showPromptPreview ? "▼ Ẩn quy trình 5-turn" : "▶ Xem chi tiết quy trình 5-turn"}</span>
          </button>
        </div>

        {showPromptPreview && (
          <div className="mt-2 p-3 rounded-lg bg-[#0B0F14] border border-[#344254] text-xs text-[#C3CEDB] mono space-y-2">
            <div><strong className="text-[#26D9FF]">Turn 1:</strong> Viết lại nội dung thành kịch bản tiếng Nhật (văn nói người già, gay gắt, thô ráp, drama).</div>
            <div><strong className="text-[#26D9FF]">Turn 2:</strong> viết lại tiêu đề sao cho GAY GẮT, KHẲNG ĐỊNH, THÔ RÁP, DRAMA. chuẩn SEO. bắt đầu bằng 【99％が知らない】</div>
            <div><strong className="text-[#26D9FF]">Turn 3:</strong> viết mô tả ngắn gọn chuẩn SEO cho video và 3 #tag</div>
            <div><strong className="text-[#26D9FF]">Turn 4:</strong> chốt [tiêu đề ở trên] + hãy đề xuất text trên thumb (3 dòng không quá dài) sao cho clickbait, gây gốc, GAY GẮT, KHẲNG ĐỊNH, THÔ RÁP, DRAMA.</div>
            <div><strong className="text-[#26D9FF]">Turn 5:</strong> Upload phoi-ko-jp.png + @Create image: Thiết kế thumbnail hoàn chỉnh (nhân vật phải 35-42%, 3 dòng chữ trái 58-65%, nền đỏ đen khói lửa, Gothic đậm).</div>
          </div>
        )}
      </form>

      {/* Loading Progress */}
      {loading && (
        <div className="p-4 rounded-lg bg-[#26D9FF]/10 border border-[#26D9FF]/30 space-y-2">
          <div className="flex items-center gap-2 text-sm text-[#26D9FF] font-medium">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            <span>{step}</span>
          </div>
          <div className="w-full bg-[#0B0F14] h-1.5 rounded-full overflow-hidden">
            <div className="bg-[#26D9FF] h-full animate-pulse w-4/5"></div>
          </div>
          <div className="text-[11px] text-[#95A3B5]">
            * 5 lượt hội thoại diễn ra liên tục trên cùng 1 phiên chat (Thinking: High + DALL-E image generation). Vui lòng giữ tab mở.
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 rounded-lg bg-[#FF5C7A]/10 border border-[#FF5C7A]/40 text-[#FF5C7A] text-sm">
          <span className="font-semibold">Lỗi: </span>
          {error}
        </div>
      )}

      {/* Full Results Package */}
      {result && (
        <div className="space-y-5 pt-3 border-t border-[#344254]">
          {/* Top Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-[#0B0F14] border border-[#344254]">
            <div className="truncate max-w-md">
              <div className="text-xs text-[#95A3B5]">Video gốc:</div>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-[#F7FAFF] hover:text-[#26D9FF] transition-colors truncate block"
              >
                {result.title}
              </a>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyAll}
                className="px-3 py-1.5 rounded bg-[#26D9FF]/20 hover:bg-[#26D9FF]/30 border border-[#26D9FF]/40 text-[#26D9FF] text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
              >
                {copiedType === "all" ? "✓ Đã copy trọn bộ!" : "📦 Copy Trọn Gói YouTube"}
              </button>
              <button
                type="button"
                onClick={handleDownloadTxt}
                className="px-3 py-1.5 rounded bg-[#101821] hover:bg-[#344254] border border-[#344254] text-[#C3CEDB] text-xs transition-colors flex items-center gap-1 cursor-pointer"
              >
                💾 Tải .txt
              </button>
              {result.conversationUrl && (
                <a
                  href={result.conversationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[#26D9FF] underline px-2"
                >
                  Mở Phiên Chat GPT ↗
                </a>
              )}
            </div>
          </div>

          {/* 1. Tiêu Đề Nhật Bản */}
          <div className="p-4 rounded-lg bg-[#0B0F14] border border-[#344254] space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-[#26D9FF] uppercase tracking-wider flex items-center gap-2">
                <span>📌 Tiêu Đề Tiếng Nhật (Chuẩn SEO • Hook 【99％が知らない】)</span>
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(result.titleJp, "title")}
                className="text-xs px-2.5 py-1 rounded bg-[#101821] hover:bg-[#344254] border border-[#344254] text-[#C3CEDB] transition-colors cursor-pointer"
              >
                {copiedType === "title" ? "✓ Đã copy!" : "📋 Copy Tiêu Đề"}
              </button>
            </div>
            <div className="text-base font-bold text-[#F7FAFF] leading-relaxed">
              {result.titleJp}
            </div>
          </div>

          {/* 2. Generated Thumbnail Image & Visual Mockup */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Real AI Generated Thumbnail Image from Turn 5 */}
            <div className="p-4 rounded-lg bg-[#0B0F14] border border-[#344254] flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#FF5C7A] uppercase tracking-wider flex items-center gap-1.5">
                  <span>🎨 Ảnh Thumbnail Hoàn Chỉnh (Turn 5 @Create image)</span>
                </span>
                {result.thumbnailImageUrl && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#43D17A]/20 text-[#43D17A] font-bold">
                    HD 16:9 READY
                  </span>
                )}
              </div>

              {result.thumbnailImageUrl ? (
                <div className="w-full aspect-video rounded-lg overflow-hidden border-2 border-[#FF5C7A]/40 relative group shadow-2xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={result.thumbnailImageUrl}
                    alt="Generated Japanese Thumbnail"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute bottom-2 right-2 opacity-90 group-hover:opacity-100 transition-opacity">
                    <a
                      href={result.thumbnailImageUrl}
                      download={`thumbnail_jp_${Date.now()}.png`}
                      className="px-3 py-1.5 rounded bg-[#000000]/80 hover:bg-[#000000] text-[#FFFFFF] text-xs font-semibold border border-white/20 shadow-lg flex items-center gap-1 cursor-pointer"
                    >
                      💾 Tải Ảnh HD (.png)
                    </a>
                  </div>
                </div>
              ) : (
                <div className="w-full aspect-video rounded-lg bg-[#101821] border border-dashed border-[#344254] flex flex-col items-center justify-center text-center p-4 text-xs text-[#95A3B5]">
                  <span>Chưa có ảnh hoàn chỉnh (Turn 5 đã bị bỏ qua hoặc đang tạo lại).</span>
                </div>
              )}

              <div className="text-[11px] text-[#95A3B5]">
                * Bố cục: Nhân vật bên phải 35-42% • Text bên trái 58-65% • Nền khói lửa dữ dội.
              </div>
            </div>

            {/* Visual 16:9 Mockup & Text Options */}
            <div className="p-4 rounded-lg bg-[#0B0F14] border border-[#344254] flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#F7C948] uppercase tracking-wider">
                  🖼️ Mockup & Các Phương Án Text (Turn 4)
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(selectedThumb, "thumb")}
                  className="text-xs px-2.5 py-1 rounded bg-[#101821] hover:bg-[#344254] border border-[#344254] text-[#C3CEDB] transition-colors cursor-pointer"
                >
                  {copiedType === "thumb" ? "✓ Đã copy text!" : "📋 Copy Text"}
                </button>
              </div>

              {/* 16:9 Visual Text Box */}
              <div className="w-full aspect-video rounded-lg bg-gradient-to-br from-[#1C0F0A] via-[#0D131A] to-[#05080C] border-2 border-[#F7C948]/30 flex flex-col items-center justify-center p-4 text-center shadow-inner relative overflow-hidden">
                <div className="absolute inset-0 bg-radial from-transparent via-black/40 to-black/80 pointer-events-none"></div>
                <div className="relative z-10 space-y-2 font-black tracking-wider leading-tight">
                  {thumbLines.map((line, idx) => (
                    <div
                      key={idx}
                      className={`text-lg sm:text-2xl drop-shadow-[0_4px_10px_rgba(0,0,0,1)] ${
                        idx === 0
                          ? "text-[#FFF500] font-extrabold"
                          : idx === 1
                          ? "text-[#FF4040] font-extrabold"
                          : "text-[#FFFFFF]"
                      }`}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>

              {/* Options list */}
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => setSelectedThumb(result.thumbnailText)}
                  className={`w-full text-left p-2 rounded border transition-all cursor-pointer text-xs ${
                    selectedThumb === result.thumbnailText
                      ? "bg-[#F7C948]/15 border-[#F7C948] text-[#F7FAFF]"
                      : "bg-[#101821] border-[#344254] text-[#95A3B5] hover:border-[#64748B]"
                  }`}
                >
                  <span className="font-semibold text-[#F7C948]">★ Mẫu mạnh nhất: </span>
                  <span className="font-bold">{result.thumbnailText.replace(/\n/g, " / ")}</span>
                </button>

                {result.thumbnailOptions?.map((opt, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setSelectedThumb(opt)}
                    className={`w-full text-left p-2 rounded border transition-all cursor-pointer text-xs ${
                      selectedThumb === opt
                        ? "bg-[#F7C948]/15 border-[#F7C948] text-[#F7FAFF]"
                        : "bg-[#101821] border-[#344254] text-[#95A3B5] hover:border-[#64748B]"
                    }`}
                  >
                    <span className="font-semibold text-[#95A3B5]">PA {index + 1}: </span>
                    <span>{opt.replace(/\n/g, " / ")}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Mô Tả & 3 Hashtag SEO */}
          <div className="p-4 rounded-lg bg-[#0B0F14] border border-[#344254] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#C3CEDB] uppercase tracking-wider">
                📝 Mô Tả Video & 3 #Hashtags (Chuẩn SEO YouTube)
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(result.descriptionJp, "desc")}
                className="text-xs px-2.5 py-1 rounded bg-[#101821] hover:bg-[#344254] border border-[#344254] text-[#C3CEDB] transition-colors cursor-pointer"
              >
                {copiedType === "desc" ? "✓ Đã copy!" : "📋 Copy Mô Tả"}
              </button>
            </div>
            <textarea
              readOnly
              value={result.descriptionJp}
              rows={4}
              className="w-full p-3 rounded-lg bg-[#101821] border border-[#344254] text-[#C3CEDB] text-xs leading-relaxed font-sans focus:outline-none"
            />
          </div>

          {/* 4. Kịch Bản Tiếng Nhật & Audio Synthesis */}
          <div className="p-4 rounded-lg bg-[#0B0F14] border border-[#344254] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#C3CEDB] uppercase tracking-wider">
                  📜 Kịch Bản Tiếng Nhật Văn Nói (Giọng Ông Lão Gay Gắt, Thô Ráp)
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-[#43D17A]/10 text-[#43D17A] mono font-semibold">
                  {result.charCount.toLocaleString()} ký tự
                </span>
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(result.scriptJp, "script")}
                className="text-xs px-2.5 py-1 rounded bg-[#101821] hover:bg-[#344254] border border-[#344254] text-[#C3CEDB] transition-colors cursor-pointer"
              >
                {copiedType === "script" ? "✓ Đã copy!" : "📋 Copy Kịch Bản"}
              </button>
            </div>

            <textarea
              readOnly
              value={result.scriptJp}
              rows={8}
              className="w-full p-3 rounded-lg bg-[#101821] border border-[#344254] text-[#F7FAFF] text-xs leading-relaxed font-sans focus:outline-none select-all"
            />

            {/* 1-Click TTS Synthesis */}
            <div className="pt-2 border-t border-[#344254] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#F7FAFF] flex items-center gap-2">
                  <span>🎙️ Sinh Giọng Audio Drama (Cụ Matsushita Seg A)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#26D9FF]/20 text-[#26D9FF] mono">v2Pro CUDA</span>
                </div>
                <div className="text-[11px] text-[#95A3B5]">
                  Render kịch bản trên thành file âm thanh WAV với giọng đọc đanh thép, khẳng định.
                </div>
              </div>

              <button
                type="button"
                onClick={handleSynthesizeDramaAudio}
                disabled={ttsLoading}
                className={`px-4 py-2 rounded-lg text-xs font-semibold shrink-0 flex items-center gap-2 cursor-pointer transition-all ${
                  ttsLoading
                    ? "bg-[#344254] text-[#95A3B5] cursor-not-allowed"
                    : "bg-[#26D9FF] text-[#0B0F14] hover:bg-[#26D9FF]/90 hover:shadow-[0_0_15px_rgba(38,217,255,0.4)]"
                }`}
              >
                {ttsLoading ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-[#0B0F14]" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                    </svg>
                    <span>Đang sinh audio trên GPU...</span>
                  </>
                ) : (
                  <span>▶ Sinh & Nghe Giọng Audio Drama</span>
                )}
              </button>
            </div>

            {ttsError && (
              <div className="p-2 rounded bg-[#FF5C7A]/10 text-[#FF5C7A] text-xs">
                Lỗi sinh audio: {ttsError}
              </div>
            )}

            {audioUrl && (
              <div className="pt-2 border-t border-[#344254]/60 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-[#43D17A] font-semibold flex items-center gap-1.5">
                    <span>✓ Audio Drama đã sẵn sàng (Giọng cụ Matsushita Seg A):</span>
                  </div>
                  <a
                    href={audioUrl}
                    download={`narration_drama_${result.videoId || "video"}.wav`}
                    className="text-xs px-3 py-1 rounded bg-[#101821] hover:bg-[#344254] border border-[#344254] text-[#26D9FF] hover:text-[#FFFFFF] transition-colors flex items-center gap-1.5 cursor-pointer font-medium"
                  >
                    <span>💾 Tải File Audio (.wav)</span>
                  </a>
                </div>
                <audio controls src={audioUrl} className="w-full h-10 rounded" autoPlay />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}