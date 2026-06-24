import path from "node:path";

// Local assembly project layout for the deferred DRIFTER pipeline:
//   one episode -> one pixel-art loop image + one Veo loop + the Suno tracks,
//   assembled locally on the Mac into the final long-form video.
const DEFAULT_RUN_VEO_ROOT = "/Users/sangspm/Downloads/VibeCoding/RUN_VEO_V1.1";

export interface ManualEpisodeProjectInfo {
  projectName: string;
  projectDir: string;
  imageOutputDir: string;
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
    imageOutputDir: path.join(downloadDir, "image"),
    videoOutputDir: path.join(downloadDir, "video"),
    audioOutputDir: path.join(downloadDir, "audio"),
    finalVideoPath: path.join(downloadDir, "final_video.mp4"),
    trackCount: episode.trackCount ?? 0,
  };
}
