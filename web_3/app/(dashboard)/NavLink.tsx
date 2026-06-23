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
        "relative flex h-[52px] items-center text-[14px] font-medium transition-colors duration-150",
        isActive ? "text-[#1C1C1E] dark:text-white" : "text-[#6E6E73] hover:text-[#1C1C1E] dark:hover:text-[#AEAEB2]"
      ].join(" ")}
    >
      {label}
      {isActive && (
        <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#1C1C1E] dark:bg-white rounded-t" />
      )}
    </Link>
  );
}
