"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={[
        "relative flex h-[52px] shrink-0 items-center text-[14px] font-medium transition-colors duration-150",
        isActive
          ? "text-[var(--text-primary)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
      ].join(" ")}
    >
      {label}
      {isActive && (
        <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-t bg-[var(--accent-cyan)]" />
      )}
    </Link>
  );
}
