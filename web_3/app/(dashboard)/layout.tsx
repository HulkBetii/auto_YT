import { AutoRefresh } from "./AutoRefresh";
import { NavLink } from "./NavLink";
import { Command } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/videos", label: "Episodes" },
  { href: "/needs-attention", label: "Attention" },
  { href: "/prompts", label: "Prompts" },
  { href: "/settings", label: "Settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-[#F2F2F7] dark:bg-black font-sans">
      <AutoRefresh />
      <header className="fixed inset-x-0 top-0 z-50 h-[52px] border-b border-black/[.08] bg-white/70 backdrop-blur-xl saturate-150 dark:border-white/[.10] dark:bg-[#1C1C1E]/70">
        <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Command className="h-4 w-4 text-[#1C1C1E] dark:text-white" />
            <span className="text-[17px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
              Drifter 2077
            </span>
          </div>
          <nav className="flex gap-4">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} />
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 pt-[52px]">
        <div className="mx-auto max-w-5xl px-6 py-8 space-y-8 animate-in fade-in duration-150">{children}</div>
      </main>
    </div>
  );
}
