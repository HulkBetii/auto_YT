import { existsSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { getDrConfigValue, setDrConfigValue } from "@/lib/db/repo/channel-config";
import { listReadyDrEpisodes, updateDrEpisodeStatus } from "@/lib/db/repo/episodes";
import { DR_CONFIG_KEYS } from "@/lib/db/schema";
import { ensureManualEpisodeProjectDirs } from "@/lib/manual-image-project";

const READY_SCAN_LIMIT = 10;

export interface LocalAssemblyResult {
  checked: number;
  started: number;
  skipped: Array<{ episodeId: number; reason: string }>;
}

function scriptPath(): string {
  return path.join(process.cwd(), "scripts", "assemble_video.py");
}

function logPath(episodeId: number): string {
  return path.join(process.cwd(), `assemble_e${episodeId}.log`);
}

async function canRunLocalAssembly(): Promise<boolean> {
  if (process.env.VERCEL === "1") return false;
  const paused = await getDrConfigValue(DR_CONFIG_KEYS.runVeoWatcherPaused).catch(() => null);
  return paused !== "true" && existsSync(scriptPath());
}

export async function runLocalAssemblyWatcher(): Promise<LocalAssemblyResult> {
  const result: LocalAssemblyResult = { checked: 0, started: 0, skipped: [] };
  if (!(await canRunLocalAssembly())) return result;

  await setDrConfigValue(DR_CONFIG_KEYS.runVeoWatcherLastSeen, new Date().toISOString()).catch(() => {});

  const episodes = await listReadyDrEpisodes(READY_SCAN_LIMIT);
  for (const episode of episodes) {
    result.checked += 1;
    const project = await ensureManualEpisodeProjectDirs({ id: episode.id });
    const introPath = path.join(project.videoOutputDir, "intro.mp4");
    const loopPath = path.join(project.videoOutputDir, "loop.mp4");
    if (!existsSync(introPath) || !existsSync(loopPath)) {
      result.skipped.push({ episodeId: episode.id, reason: "missing intro.mp4 or loop.mp4" });
      continue;
    }

    await updateDrEpisodeStatus(episode.id, "assembly_pending");
    await mkdir(path.dirname(logPath(episode.id)), { recursive: true });
    const logFile = openSync(logPath(episode.id), "a");
    const child = spawn("python3", [scriptPath(), String(episode.id)], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", logFile, logFile],
    });
    child.unref();
    result.started += 1;
  }

  return result;
}
