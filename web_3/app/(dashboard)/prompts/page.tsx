import { getActiveDrPromptVersion } from "@/lib/db/repo/prompt-versions";
import { PromptEditor } from "./PromptEditor";

export const dynamic = "force-dynamic";

const PROMPT_KEYS = ["D0", "D1", "D2A", "D2B", "D2C", "D3", "D4"];

export default async function PromptsPage() {
  const prompts = await Promise.all(
    PROMPT_KEYS.map(async (key) => ({ key, row: await getActiveDrPromptVersion(key) })),
  );

  return (
    <>
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E] dark:text-white">
          Prompts
        </h1>
        <p className="mt-1 text-[15px] leading-relaxed text-[#6E6E73] dark:text-[#AEAEB2]">
          Active prompt templates for each pipeline stage. Saving creates a new version.
        </p>
      </div>

      <PromptEditor prompts={prompts} />
    </>
  );
}
