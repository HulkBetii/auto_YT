import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
      <p className="text-[15px] text-[#AEAEB2]">Chưa có nội dung nào được tạo.</p>
    );
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#E5E5EA] dark:bg-white/[.10]" />

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
              <div className="absolute left-0 top-[5px] h-3.5 w-3.5 rounded-full border-2 border-[#F2F2F7] bg-[#34C759] dark:border-black" />

              {/* Step header */}
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-medium text-[#1C1C1E] dark:text-white">
                  {row.stage}
                </span>
                <span className="text-[13px] text-[#AEAEB2]">
                  {formatDateTime(row.createdAt)}
                </span>
                {durationSec != null && (
                  <Badge className="font-mono text-[12px] bg-[#E5E5EA] text-[#3C3C43] border-0 dark:bg-white/[.10] dark:text-[#AEAEB2]">
                    {formatDuration(durationSec)}
                  </Badge>
                )}
              </div>

              {/* Accordion content */}
              <Accordion multiple={false}>
                <AccordionItem value="content" className="border-0">
                  <AccordionTrigger className="py-1 text-[13px] text-[#6E6E73] hover:text-[#1C1C1E] hover:no-underline dark:hover:text-white">
                    Xem nội dung ({row.output.length.toLocaleString()} ký tự)
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="relative mt-1">
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[#F2F2F7] p-4 font-mono text-[12px] text-[#1C1C1E] dark:bg-[#1C1C1E] dark:text-white">
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
