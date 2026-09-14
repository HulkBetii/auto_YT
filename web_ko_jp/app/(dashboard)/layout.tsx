import Link from "next/link";
import React from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[#0B1016] text-[#F7FAFF]">
      {/* Top Navbar */}
      <header className="border-b border-[#344254] bg-[#121923]/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#26D9FF] animate-pulse"></span>
              <span className="font-bold tracking-wider text-sm mono text-[#26D9FF]">auto_YT</span>
              <span className="text-xs text-[#95A3B5] px-1.5 py-0.5 rounded bg-[#18212C] border border-[#344254]">
                KO ⇄ JP
              </span>
            </Link>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/" className="text-[#F7FAFF] hover:text-[#26D9FF] transition-colors">
              Pipeline Overview
            </Link>
            <Link href="/prompts" className="text-[#95A3B5] hover:text-[#26D9FF] transition-colors">
              Prompt Versioning
            </Link>
            <span className="text-xs px-2 py-0.5 rounded bg-[#43D17A]/10 text-[#43D17A] border border-[#43D17A]/30">
              Port: 3004
            </span>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#344254] py-4 text-center text-xs text-[#95A3B5]">
        auto_YT Localization Engine (web_ko_jp) &bull; Local Postgres :5437 &bull; Playwright GPT-5.6 Sol
      </footer>
    </div>
  );
}
