import { getActiveAhPromptVersion } from "@/lib/db/repo/prompt-versions";
import { PromptEditor } from "./PromptEditor";

export const dynamic = "force-dynamic";

const PROMPT_KEYS = ["S1", "S2", "S3", "S4"];

export default async function PromptsPage() {
  const prompts = await Promise.all(
    PROMPT_KEYS.map(async (key) => ({ key, row: await getActiveAhPromptVersion(key) })),
  );

  return (
    <>
      <div className="mb-2">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
          Prompts
        </h1>
        <p className="mt-1 text-[15px] text-[#6E6E73]">
          Active prompt templates for each pipeline stage. Saving creates a new version.
        </p>
      </div>

      <PromptEditor prompts={prompts} />
    </>
  );
}
