import { AutoRefresh } from "./AutoRefresh";
import { NavLink } from "./NavLink";
import { Command } from "lucide-react";
const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/videos", label: "Episodes" },
  { href: "/study", label: "Study" },
  { href: "/needs-attention", label: "Attention" },
  { href: "/prompts", label: "Prompts" },
  { href: "/settings", label: "Settings" },
];
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col bg-[var(--dashboard-bg)] font-sans">
      <AutoRefresh />
      <header className="fixed inset-x-0 top-0 z-50 h-[52px] border-b border-[var(--border-subtle)] bg-[rgba(18,25,35,0.9)] backdrop-blur-xl saturate-150">
        <div className="mx-auto flex h-full max-w-5xl items-center gap-3 px-4 sm:px-6">
          <div className="flex shrink-0 items-center gap-2">
            <Command className="h-4 w-4 text-[var(--text-primary)]" />
            <span className="text-[17px] font-semibold tracking-tight text-[var(--text-primary)]">
              Drifter 2077
            </span>
          </div>
          <nav className="flex min-w-0 flex-1 justify-start gap-4 overflow-x-auto md:justify-end">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} />
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 pt-[52px]">
        <div className="mx-auto max-w-5xl px-6 py-8 space-y-8 animate-in fade-in duration-150">
          {children}
        </div>
      </main>
    </div>
  );
}
