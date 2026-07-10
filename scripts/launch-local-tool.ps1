param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("web", "web_2", "web_3")]
  [string]$App
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "auto_YT $App launcher"

$root = "D:\VibeCoding\auto_YT"
$apps = @{
  web = @{ Dir = Join-Path $root "web"; Port = 3000; DbPort = 5434; Url = "http://localhost:3000"; RequiresRunVeo = $false }
  web_2 = @{ Dir = Join-Path $root "web_2"; Port = 3001; DbPort = 5435; Url = "http://localhost:3001"; RequiresRunVeo = $true }
  web_3 = @{ Dir = Join-Path $root "web_3"; Port = 3002; DbPort = 5433; Url = "http://localhost:3002"; RequiresRunVeo = $true }
}

$config = $apps[$App]
$runVeoRoot = "D:\VibeCoding\RUN_VEO_V1.1"

function Write-Step([string]$Message) {
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] OK: $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] WARN: $Message" -ForegroundColor Yellow
}

function Fail([string]$Message) {
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] FAIL: $Message" -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

function Test-UrlOk([string]$Url) {
  try {
    $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return ($res.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Wait-Url([string]$Url, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-UrlOk $Url) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Test-CommandExists([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-DockerDesktop {
  Write-Step "Checking Docker Desktop"
  $dockerOk = $false
  try {
    docker version *> $null
    docker compose version *> $null
    $dockerOk = $true
  } catch {
    $dockerOk = $false
  }

  if ($dockerOk) {
    Write-Ok "Docker daemon and compose are ready"
    return
  }

  Write-Warn "Docker is not ready; trying to start Docker Desktop"
  $dockerDesktopPaths = @(
    "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
    "$env:LocalAppData\Docker\Docker Desktop.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }

  if (-not $dockerDesktopPaths -or $dockerDesktopPaths.Count -eq 0) {
    Fail "Docker Desktop executable not found. Please start Docker Desktop manually."
  }

  Start-Process -FilePath $dockerDesktopPaths[0] | Out-Null
  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline) {
    try {
      docker version *> $null
      docker compose version *> $null
      Write-Ok "Docker Desktop is ready"
      return
    } catch {
      Start-Sleep -Seconds 5
    }
  }

  Fail "Docker Desktop did not become ready within 3 minutes."
}

function Ensure-ProjectFiles {
  Write-Step "Checking project files for $App"
  if (-not (Test-Path $config.Dir)) { Fail "Missing app directory: $($config.Dir)" }
  if (-not (Test-Path (Join-Path $config.Dir "package.json"))) { Fail "Missing package.json in $($config.Dir)" }
  if (-not (Test-Path (Join-Path $config.Dir ".env.local"))) { Fail "Missing .env.local in $($config.Dir)" }
  Write-Ok "Required files exist"

  if ($config.RequiresRunVeo) {
    $envText = Get-Content (Join-Path $config.Dir ".env.local") -Raw
    $expected = "RUN_VEO_ROOT=$runVeoRoot"
    if ($envText -notmatch [regex]::Escape($expected)) {
      Fail "Missing expected $expected in $($config.Dir)\.env.local"
    }
    if (-not (Test-Path (Join-Path $runVeoRoot "run_veo_4.0.py"))) {
      Fail "RUN_VEO_ROOT is configured but run_veo_4.0.py is missing under $runVeoRoot"
    }
    Write-Ok "RUN_VEO_ROOT is configured"
  }
}

function Ensure-NodeAndPnpm {
  Write-Step "Checking Node and pnpm"
  if (-not (Test-CommandExists "node")) { Fail "node command not found" }
  if (-not (Test-CommandExists "corepack")) { Fail "corepack command not found" }
  Push-Location $config.Dir
  try {
    corepack pnpm --version | Out-Host
  } finally {
    Pop-Location
  }
  Write-Ok "Node/corepack pnpm available"
}

function Ensure-Dependencies {
  $nodeModules = Join-Path $config.Dir "node_modules"
  if (Test-Path $nodeModules) {
    Write-Ok "node_modules exists; skipping install"
    return
  }

  Write-Step "node_modules missing; running pnpm install in $($config.Dir)"
  Push-Location $config.Dir
  try {
    $env:CI = "true"
    corepack pnpm install
    if ($LASTEXITCODE -ne 0) { Fail "pnpm install failed for $App" }
  } finally {
    Pop-Location
  }
  Write-Ok "Dependencies installed"
}

function Ensure-Database {
  Write-Step "Ensuring Postgres for $App"
  Push-Location $config.Dir
  try {
    corepack pnpm db:up
    if ($LASTEXITCODE -ne 0) { Fail "pnpm db:up failed for $App" }

    $deadline = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $deadline) {
      $dbConn = Get-NetTCPConnection -LocalPort $config.DbPort -State Listen -ErrorAction SilentlyContinue
      if ($dbConn) { break }
      Start-Sleep -Seconds 2
    }

    if (-not (Get-NetTCPConnection -LocalPort $config.DbPort -State Listen -ErrorAction SilentlyContinue)) {
      Fail "Postgres port $($config.DbPort) is not listening after db:up"
    }

    corepack pnpm db:migrate
    if ($LASTEXITCODE -ne 0) { Fail "pnpm db:migrate failed for $App" }
  } finally {
    Pop-Location
  }
  Write-Ok "Database is up and migrated"
}


function Ensure-ControlServer {
  $controlUrl = "http://localhost:4242/status"
  Write-Step "Checking auto_yt control server"
  if (Test-UrlOk $controlUrl) {
    Write-Ok "Control server is already running"
    return
  }

  $portConn = Get-NetTCPConnection -LocalPort 4242 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($portConn) {
    $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($portConn.OwningProcess)" -ErrorAction SilentlyContinue
    $ownerCommand = if ($ownerProcess) { [string]$ownerProcess.CommandLine } else { "" }
    if ($ownerCommand -match "auto_yt\.control_server|control_server\.py") {
      Write-Warn "Port 4242 is held by an unresponsive auto_yt control server; restarting PID $($portConn.OwningProcess)"
      Stop-Process -Id $portConn.OwningProcess -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
    } else {
      Fail "Port 4242 is occupied but $controlUrl does not return HTTP 200. Owner PID=$($portConn.OwningProcess). Not killing unknown process."
    }
  }

  $autoVenvPython = Join-Path $root ".venv\Scripts\python.exe"
  $autoVenvPip = Join-Path $root ".venv\Scripts\pip.exe"
  if (-not (Test-Path $autoVenvPython)) {
    Write-Step "Creating auto_YT Python 3.11 venv"
    Push-Location $root
    try {
      py -3.11 -m venv .venv
      if ($LASTEXITCODE -ne 0) { Fail "Failed to create auto_YT Python venv with py -3.11" }
    } finally {
      Pop-Location
    }
  } else {
    Write-Ok "auto_YT Python venv exists"
  }

  Write-Step "Ensuring auto_YT Python dependencies"
  Push-Location $root
  try {
    & $autoVenvPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { Fail "pip upgrade failed for auto_YT venv" }
    & $autoVenvPip install -r (Join-Path $root "requirements.txt")
    if ($LASTEXITCODE -ne 0) { Fail "pip install -r requirements.txt failed for auto_YT venv" }
  } finally {
    Pop-Location
  }

  Write-Step "Starting auto_yt.control_server"
  $log = Join-Path $root ".control-server.log"
  $err = Join-Path $root ".control-server.err.log"
  $srcPath = Join-Path $root "src"
  $cmd = "Set-Location '$root'; `$env:PYTHONPATH='$srcPath'; & '$autoVenvPython' -m auto_yt.control_server"
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cmd) -WorkingDirectory $root -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden | Out-Null

  if (-not (Wait-Url $controlUrl 30)) {
    Write-Warn "Control server did not return HTTP 200 within 30 seconds"
    Write-Host "stdout: $log"
    Write-Host "stderr: $err"
    Fail "Could not verify auto_yt.control_server"
  }
  Write-Ok "Control server is ready"
}

function Ensure-PlaywrightBrowsers {
  $autoVenvPython = Join-Path $root ".venv\Scripts\python.exe"
  if (-not (Test-Path $autoVenvPython)) {
    Write-Warn "auto_YT Python venv missing; control server setup will create it before Playwright browser check"
    return
  }

  Write-Step "Checking Playwright Chromium browser"
  $checkScript = "from pathlib import Path; from playwright.sync_api import sync_playwright; p=sync_playwright().start(); path=Path(p.chromium.executable_path); print(path); ok=path.exists(); p.stop(); raise SystemExit(0 if ok else 1)"
  & $autoVenvPython -c $checkScript
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "Playwright Chromium is installed"
    return
  }

  Write-Step "Installing Playwright Chromium browser"
  & $autoVenvPython -m playwright install chromium
  if ($LASTEXITCODE -ne 0) { Fail "playwright install chromium failed" }
  Write-Ok "Playwright Chromium installed"
}
function Ensure-DevServer {
  Write-Step "Checking dev server $($config.Url)"
  if (Test-UrlOk $config.Url) {
    Write-Ok "$($config.Url) is already running; skipping dev start"
    return
  }

  $portConn = Get-NetTCPConnection -LocalPort $config.Port -State Listen -ErrorAction SilentlyContinue
  if ($portConn) {
    Fail "Port $($config.Port) is occupied but $($config.Url) does not return HTTP 200. Not killing unknown process."
  }

  Write-Step "Starting Next.js dev server for $App"
  $log = Join-Path $config.Dir ".shortcut-local-dev.log"
  $err = Join-Path $config.Dir ".shortcut-local-dev.err.log"
  $cmd = "Set-Location '$($config.Dir)'; `$env:CI='true'; corepack pnpm local:dev"
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cmd) -WorkingDirectory $config.Dir -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden | Out-Null

  if (-not (Wait-Url $config.Url 60)) {
    Write-Warn "Dev server did not return HTTP 200 within 60 seconds"
    Write-Host "stdout: $log"
    Write-Host "stderr: $err"
    Fail "Could not verify $($config.Url)"
  }
  Write-Ok "Dev server is ready"
}

Write-Host "auto_YT launcher for $App" -ForegroundColor Magenta
Write-Host "App dir: $($config.Dir)"
Write-Host "URL: $($config.Url)"
Write-Host ""

Ensure-ProjectFiles
Ensure-NodeAndPnpm
Ensure-DockerDesktop
Ensure-Dependencies
Ensure-Database
Ensure-ControlServer
Ensure-PlaywrightBrowsers
Ensure-DevServer

Write-Step "Opening browser"
Start-Process $config.Url
Write-Ok "Done: $($config.Url)"
Write-Host ""
Write-Host "You can close this window, or press Enter to close it now."
Read-Host "Press Enter to close"





