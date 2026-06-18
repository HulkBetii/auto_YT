import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function getRunVeoPaths() {
  const defaultRunVeoDir = ["", "Users", "sangspm", "Desktop", "RUN_VEO_V1.1"].join("/");
  const runVeoDir = (process.env.RUN_VEO_DIR ?? defaultRunVeoDir).replace(/\/$/, "");
  return {
    runVeoDir,
    scriptPath: `${runVeoDir}/pipeline_watch.py`,
  };
}

export interface RunVeoWatcherStatus {
  available: boolean;
  running: boolean;
  pid: number | null;
  scriptPath: string;
  runVeoDir: string;
  message?: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function findWatcherPids(scriptPath: string): Promise<number[]> {
  const pids = new Set<number>();
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="]);
    for (const line of stdout.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) continue;

      const pid = Number.parseInt(match[1], 10);
      const command = match[2];
      const isPythonWatcher =
        command.includes(scriptPath) && /(^|\/)python(?:3(?:\.\d+)?)?\s/.test(command);
      if (isPythonWatcher && Number.isFinite(pid) && pid !== process.pid && isAlive(pid)) {
        pids.add(pid);
      }
    }
  } catch {
    // ps failures should not break the dashboard.
  }

  return [...pids];
}

export async function getRunVeoWatcherStatus(): Promise<RunVeoWatcherStatus> {
  const { runVeoDir, scriptPath } = getRunVeoPaths();

  if (process.platform !== "darwin") {
    return {
      available: false,
      running: false,
      pid: null,
      scriptPath,
      runVeoDir,
      message: "RUN_VEO watcher control is only available on local macOS.",
    };
  }

  const pids = await findWatcherPids(scriptPath);
  return {
    available: true,
    running: pids.length > 0,
    pid: pids[0] ?? null,
    scriptPath,
    runVeoDir,
  };
}

export async function startRunVeoWatcher(): Promise<RunVeoWatcherStatus> {
  const current = await getRunVeoWatcherStatus();
  if (!current.available || current.running) return current;

  const { runVeoDir, scriptPath } = getRunVeoPaths();
  const child = spawn(process.env.RUN_VEO_PYTHON ?? "python3", [scriptPath], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  return {
    available: true,
    running: true,
    pid: child.pid ?? null,
    scriptPath,
    runVeoDir,
  };
}

export async function stopRunVeoWatcher(): Promise<RunVeoWatcherStatus> {
  const { scriptPath } = getRunVeoPaths();
  const pids = await findWatcherPids(scriptPath);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have exited between pgrep and kill.
    }
  }

  return getRunVeoWatcherStatus();
}
