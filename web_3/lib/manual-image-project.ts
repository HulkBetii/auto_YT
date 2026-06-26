import path from "node:path";
import { mkdir } from "node:fs/promises";

// Local assembly project layout for the deferred DRIFTER pipeline:
//   one episode -> manual intro/loop videos + the Suno tracks,
//   assembled locally on the Mac into the final long-form video.
const DEFAULT_RUN_VEO_ROOT = "/Users/sangspm/Downloads/VibeCoding/RUN_VEO_V1.1";

export interface ManualEpisodeProjectInfo {
  projectName: string;
  projectDir: string;
  videoOutputDir: string;
  audioOutputDir: string;
  finalVideoPath: string;
  trackCount: number;
}

export interface ManualEpisodeProject {
  id: number;
  trackCount?: number;
}

export function getRunVeoRoot(): string {
  return process.env.RUN_VEO_ROOT?.trim() || DEFAULT_RUN_VEO_ROOT;
}

export function getRunVeoWorkflowsDir(): string {
  return process.env.RUN_VEO_WORKFLOWS_DIR?.trim() || path.join(getRunVeoRoot(), "Workflows");
}

export function getManualEpisodeProjectInfo(episode: ManualEpisodeProject): ManualEpisodeProjectInfo {
  const projectName = `dr_e${episode.id}`;
  const projectDir = path.join(getRunVeoWorkflowsDir(), projectName);
  const downloadDir = path.join(projectDir, "Download");

  return {
    projectName,
    projectDir,
    videoOutputDir: path.join(downloadDir, "video"),
    audioOutputDir: path.join(downloadDir, "audio"),
    finalVideoPath: path.join(downloadDir, "final_video.mp4"),
    trackCount: episode.trackCount ?? 0,
  };
}

export function canWriteManualEpisodeProjectDirs(): boolean {
  return process.env.VERCEL !== "1";
}

export async function ensureManualEpisodeProjectDirs(episode: ManualEpisodeProject): Promise<ManualEpisodeProjectInfo> {
  const project = getManualEpisodeProjectInfo(episode);
  if (!canWriteManualEpisodeProjectDirs()) return project;
  await Promise.all([
    mkdir(project.projectDir, { recursive: true }),
    mkdir(project.videoOutputDir, { recursive: true }),
    mkdir(project.audioOutputDir, { recursive: true }),
  ]);
  return project;
}
