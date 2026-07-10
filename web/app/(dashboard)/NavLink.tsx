"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`text-[15px] transition-colors duration-150 ${isActive ? "text-[var(--accent-cyan)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] "}`}
    >
      {label}
    </Link>
  );
}
