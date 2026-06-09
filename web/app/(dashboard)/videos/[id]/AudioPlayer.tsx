"use client";

import { useEffect, useRef, useState } from "react";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioPlayer({ src, filename }: { src: string; filename?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => { if (!isDragging) setCurrentTime(audio.currentTime); };
    const onLoaded = () => setDuration(audio.duration);
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
    };
  }, [isDragging]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play();
      setIsPlaying(true);
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    const bar = progressRef.current;
    if (!audio || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(ratio * duration);
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-100 bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 shadow-xl dark:border-zinc-700/50">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={src} preload="metadata" />

      <div className="p-5">
        {/* Header row */}
        <div className="mb-4 flex items-center gap-3">
          {/* Animated icon */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
            {isPlaying ? (
              <span className="flex gap-0.5">
                {[1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="w-[3px] rounded-full bg-emerald-400"
                    style={{
                      height: `${12 + i * 4}px`,
                      animation: `barBounce 0.6s ease-in-out ${i * 0.1}s infinite alternate`,
                    }}
                  />
                ))}
              </span>
            ) : (
              <svg className="h-5 w-5 text-white/70" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z" />
              </svg>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              {filename ?? "Audio TTS"}
            </p>
            <p className="text-xs text-white/50">AI33.PRO · Clone Voice</p>
          </div>
          {/* Download */}
          <a
            href={src}
            download
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white"
            title="Tải xuống"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
          </a>
        </div>

        {/* Progress bar */}
        <div
          ref={progressRef}
          className="group relative mb-3 h-1.5 cursor-pointer rounded-full bg-white/10"
          onClick={seek}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 transition-all"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow-md opacity-0 transition group-hover:opacity-100"
            style={{ left: `calc(${progress}% - 7px)` }}
          />
        </div>

        {/* Time */}
        <div className="mb-4 flex justify-between text-xs text-white/40">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4">
          {/* Rewind 10s */}
          <button
            type="button"
            onClick={() => { const a = audioRef.current; if (a) { a.currentTime = Math.max(0, a.currentTime - 10); } }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
            title="-10s"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12.5 3a9 9 0 1 0 6.21 15.62l-1.42-1.42A7 7 0 1 1 12.5 5v3l4-4-4-4v3Z" />
              <text x="7" y="14.5" fontSize="5" fontWeight="bold" fill="currentColor">10</text>
            </svg>
          </button>

          {/* Play / Pause */}
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-zinc-900 shadow-lg transition hover:scale-105 hover:shadow-xl active:scale-95"
          >
            {isPlaying ? (
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg className="h-6 w-6 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M5 3l14 9-14 9V3Z" />
              </svg>
            )}
          </button>

          {/* Forward 10s */}
          <button
            type="button"
            onClick={() => { const a = audioRef.current; if (a) { a.currentTime = Math.min(duration, a.currentTime + 10); } }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
            title="+10s"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.5 3a9 9 0 1 1-6.21 15.62l1.42-1.42A7 7 0 1 0 11.5 5V8l-4-4 4-4v3Z" />
              <text x="7" y="14.5" fontSize="5" fontWeight="bold" fill="currentColor">10</text>
            </svg>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes barBounce {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}
