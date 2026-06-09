import { Badge } from "@/components/ui/badge";
import { statusBadgeClass, STATUS_LABELS } from "@/lib/ui/format";

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={`${statusBadgeClass(status)} text-[12px] font-medium`}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
