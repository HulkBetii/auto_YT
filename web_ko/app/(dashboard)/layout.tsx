import Link from "next/link";

import { AutoRefresh } from "./AutoRefresh";

const NAVIGATION = [
  { href: "/", label: "Tổng quan" },
  { href: "/videos", label: "Kịch bản" },
  { href: "/needs-attention", label: "Cần xử lý" },
  { href: "/prompts", label: "Prompt" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <AutoRefresh />
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[rgba(242,234,216,.88)] backdrop-blur-xl">
        <div className="shell flex min-h-[68px] flex-wrap items-center justify-between gap-3 py-3">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-[var(--seal)] text-lg font-black text-white shadow-lg shadow-red-950/15">福</span>
            <span>
              <strong className="display block text-[20px] leading-none">복이피는길</strong>
              <small className="muted text-[10px] font-bold uppercase tracking-[.16em]">Production room</small>
            </span>
          </Link>
          <nav className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-[var(--line)] bg-white/35 p-1">
            {NAVIGATION.map((item) => (
              <Link key={item.href} href={item.href} className="whitespace-nowrap rounded-full px-3 py-2 text-xs font-bold text-[var(--ink-soft)] hover:bg-white/70 hover:text-[var(--ink)]">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="shell py-8 md:py-12">{children}</main>
    </div>
  );
}
