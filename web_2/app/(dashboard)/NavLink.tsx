"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`text-[15px] transition-colors duration-150 ${
        isActive
          ? "text-[#007AFF]"
          : "text-[#6E6E73] hover:text-[#1C1C1E] dark:hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}
