import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatDuration } from "@/lib/ui/format";
import { CopyButton } from "./CopyButton";
interface ContentRow {
  id: number;
  stage: string;
  output: string;
  createdAt: Date | null;
}
interface JobRow {
  stage: string;
  startedAt: Date | null;
  finishedAt: Date | null;
}
export function PipelineTimeline({
  content,
  jobs,
}: {
  content: ContentRow[];
  jobs: JobRow[];
}) {
  if (content.length === 0) {
    return (
      <p className="text-[15px] text-[var(--text-secondary)]">
        Chưa có nội dung nào được tạo.
      </p>
    );
  }
  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[var(--surface-muted)] " />
      <div className="space-y-0">
        {content.map((row) => {
          const job = jobs.find((j) => j.stage === row.stage);
          const durationSec =
            job?.startedAt && job?.finishedAt
              ? (job.finishedAt.getTime() - job.startedAt.getTime()) / 1000
              : null;
          return (
            <div key={row.id} className="relative pl-8 pb-6 last:pb-0">
              {/* Green dot */}
              <div className="absolute left-0 top-[5px] h-3.5 w-3.5 rounded-full border-2 border-[var(--dashboard-bg)] bg-[var(--success)] " />
              {/* Step header */}
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-medium text-[var(--text-primary)] ">
                  {row.stage}
                </span>
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {formatDateTime(row.createdAt)}
                </span>
                {durationSec != null && (
                  <Badge className="font-mono text-[12px] bg-[var(--surface-muted)] text-[var(--text-secondary)] border-0 ">
                    {formatDuration(durationSec)}
                  </Badge>
                )}
              </div>
              {/* Accordion content */}
              <Accordion multiple={false}>
                <AccordionItem value="content" className="border-0">
                  <AccordionTrigger className="py-1 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:no-underline ">
                    Xem nội dung ({row.output.length.toLocaleString()} ký tự)
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="relative mt-1">
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--dashboard-bg)] p-4 font-mono text-[12px] text-[var(--text-primary)] ">
                        {row.output}
                      </pre>
                      <CopyButton text={row.output} />
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          );
        })}
      </div>
    </div>
  );
}
