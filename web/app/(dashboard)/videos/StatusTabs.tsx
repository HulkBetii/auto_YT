import Link from "next/link";

interface Props {
  current: string;
  statuses: readonly string[];
}

export function StatusTabs({ current, statuses }: Props) {
  const pillBase =
    "rounded-full px-4 py-1.5 text-[14px] font-medium transition-colors duration-150 whitespace-nowrap";
  const active = "bg-[#007AFF] text-white";
  const inactive = "bg-[#E5E5EA] text-[#6E6E73] hover:bg-[#D1D1D6] dark:bg-white/[.10] dark:text-[#AEAEB2] dark:hover:bg-white/[.15]";

  return (
    <div className="flex min-h-[44px] items-center gap-2 flex-wrap">
      <Link href="/videos" className={`${pillBase} ${current === "all" ? active : inactive}`}>
        Tất cả
      </Link>
      {statuses.map((s) => (
        <Link
          key={s}
          href={`/videos?status=${s}`}
          className={`${pillBase} ${current === s ? active : inactive}`}
        >
          {s}
        </Link>
      ))}
    </div>
  );
}
