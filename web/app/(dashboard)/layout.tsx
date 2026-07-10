import { AutoRefresh } from "./AutoRefresh";
import { NavLink } from "./NavLink";
const NAV_ITEMS = [
  { href: "/", label: "Tổng quan" },
  { href: "/videos", label: "Video" },
  { href: "/prompts", label: "Prompt" },
  { href: "/needs-attention", label: "Cần chú ý" },
  { href: "/settings", label: "Cài đặt" },
];
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col bg-[var(--dashboard-bg)] ">
      <AutoRefresh /> {/* Fixed top navbar */}
      <header className="fixed inset-x-0 top-0 z-50 h-[52px] border-b border-[var(--border-subtle)] bg-[rgba(18,25,35,0.9)] backdrop-blur ">
        <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-6">
          <span className="text-[17px] font-semibold text-[var(--text-primary)] ">
            哲人の刻
          </span>
          <nav className="flex gap-6">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} />
            ))}
          </nav>
        </div>
      </header>
      {/* Content — offset for fixed header */}
      <main className="flex-1 pt-[52px]">
        <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">{children}</div>
      </main>
    </div>
  );
}
