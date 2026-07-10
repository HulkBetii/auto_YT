import path from "node:path";
import { promisify } from "node:util";

const DEFAULT_RUN_VEO_DIR = "D:\\VibeCoding\\RUN_VEO_V1.1";

function loadChildProcess(): typeof import("node:child_process") {
  // Local-only process control should stay invisible to Next's NFT tracer.
  const getBuiltinModule = (process as typeof process & {
    getBuiltinModule?: (specifier: string) => unknown;
  }).getBuiltinModule;
  if (getBuiltinModule) {
    return getBuiltinModule("node:child_process") as typeof import("node:child_process");
  }

  const runtimeRequire = Function("return require")() as NodeRequire;
  return runtimeRequire("node:child_process") as typeof import("node:child_process");
}

function getRunVeoPaths() {
  const runVeoDir = (process.env.RUN_VEO_DIR ?? process.env.RUN_VEO_ROOT ?? DEFAULT_RUN_VEO_DIR).replace(/[\\/]$/, "");
  return {
    runVeoDir,
    scriptPath: path.join(runVeoDir, "pipeline_watch.py"),
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
    const { execFile } = loadChildProcess();
    const execFileAsync = promisify(execFile);
    const normalizedScript = scriptPath.toLowerCase().replace(/\\/g, "/");

    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
      ]);
      const parsed = JSON.parse(stdout || "[]");
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rows) {
        const pid = Number.parseInt(String(row.ProcessId ?? ""), 10);
        const command = String(row.CommandLine ?? "");
        const normalizedCommand = command.toLowerCase().replace(/\\/g, "/");
        if (normalizedCommand.includes(normalizedScript) && Number.isFinite(pid) && pid !== process.pid && isAlive(pid)) {
          pids.add(pid);
        }
      }
      return [...pids];
    }

    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="]);
    for (const line of stdout.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      const pid = Number.parseInt(match[1], 10);
      const command = match[2].toLowerCase().replace(/\\/g, "/");
      if (command.includes(normalizedScript) && Number.isFinite(pid) && pid !== process.pid && isAlive(pid)) {
        pids.add(pid);
      }
    }
  } catch {
    // Process listing failures should not break the dashboard.
  }

  return [...pids];
}

export async function getRunVeoWatcherStatus(): Promise<RunVeoWatcherStatus> {
  const { runVeoDir, scriptPath } = getRunVeoPaths();

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
  const { spawn } = loadChildProcess();
  const defaultWindowsPython = path.join(runVeoDir, ".venv", "Scripts", "python.exe");
  const pythonCommand = process.env.RUN_VEO_PYTHON
    ?? (process.platform === "win32" ? defaultWindowsPython : "python3");
  const child = spawn(pythonCommand, [scriptPath], {
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
