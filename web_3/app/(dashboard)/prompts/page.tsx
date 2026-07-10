import { getActiveDrPromptVersion } from "@/lib/db/repo/prompt-versions";
import { Card, CardContent } from "@/components/ui/card";
import { PromptEditor } from "./PromptEditor";
export const dynamic = "force-dynamic";
const PROMPT_KEYS = ["D0", "D1", "D2A", "D2B", "D2C", "D3", "D4"];
export default async function PromptsPage() {
  let prompts: Array<{
    key: string;
    row: Awaited<ReturnType<typeof getActiveDrPromptVersion>>;
  }> = [];
  let dbError: string | null = null;
  try {
    prompts = await Promise.all(
      PROMPT_KEYS.map(async (key) => ({
        key,
        row: await getActiveDrPromptVersion(key),
      })),
    );
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
    console.error("[prompts] database unavailable", dbError);
  }
  return (
    <>
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text-primary)]">
          Prompts
        </h1>
        <p className="mt-1 text-[15px] leading-relaxed text-[var(--text-muted)]">
          Active prompt templates for each pipeline stage. Saving creates a new
          version.
        </p>
      </div>
      {dbError ? (
        <Card className="border-[var(--warning)]/30 bg-[var(--warning-soft)] shadow-none rounded-xl">
          <CardContent className="p-5 text-[14px] text-[var(--warning)]">
            Database temporarily unavailable. Prompt templates cannot be loaded
            until the database is available again.
          </CardContent>
        </Card>
      ) : (
        <PromptEditor prompts={prompts} />
      )}
    </>
  );
}
