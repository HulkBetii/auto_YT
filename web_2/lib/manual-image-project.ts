import path from "node:path";
import fs from "node:fs";

const DEFAULT_RUN_VEO_ROOT = "/Users/sangspm/Downloads/VibeCoding/RUN_VEO_V1.1";

export interface ManualImageProjectInfo {
  projectName: string;
  projectDir: string;
  imageOutputDir: string;
  promptsPath: string;
  downloadPromptsPath: string;
  finalVideoPath: string;
  promptCount: number;
}

export interface ManualImageProjectVideo {
  id: number;
  imagePrompts?: string | null;
}

export function countImagePromptLines(imagePrompts: string | null | undefined): number {
  if (!imagePrompts) return 0;
  return imagePrompts.split("\n").filter((line) => line.trim()).length;
}

export function getRunVeoRoot(): string {
  return process.env.RUN_VEO_ROOT?.trim() || DEFAULT_RUN_VEO_ROOT;
}

export function getRunVeoWorkflowsDir(): string {
  return process.env.RUN_VEO_WORKFLOWS_DIR?.trim() || path.join(getRunVeoRoot(), "Workflows");
}

export function getManualImageProjectInfo(video: ManualImageProjectVideo): ManualImageProjectInfo {
  const projectName = `ah_v${video.id}`;
  const projectDir = path.join(getRunVeoWorkflowsDir(), projectName);
  const downloadDir = path.join(projectDir, "Download");

  return {
    projectName,
    projectDir,
    imageOutputDir: path.join(downloadDir, "image"),
    promptsPath: path.join(projectDir, "image_prompts.txt"),
    downloadPromptsPath: path.join(downloadDir, "image_prompts.txt"),
    finalVideoPath: path.join(downloadDir, "final_video.mp4"),
    promptCount: countImagePromptLines(video.imagePrompts),
  };
}

const IMAGE_SUFFIXES = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export function countManualProjectImages(imageOutputDir: string, promptCount = 0): number {
  try {
    const entries = fs.readdirSync(imageOutputDir, { withFileTypes: true });
    const promptIds = new Set<number>();

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!IMAGE_SUFFIXES.has(path.extname(entry.name).toLowerCase())) continue;

      const rawId = entry.name.split("_", 1)[0];
      const promptId = Number.parseInt(rawId, 10);
      if (!Number.isFinite(promptId) || promptId <= 0) continue;
      if (promptCount > 0 && promptId > promptCount) continue;

      promptIds.add(promptId);
    }

    return promptIds.size;
  } catch {
    return 0;
  }
}
