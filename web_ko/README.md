# Korean YouTube Script Pipeline

Local dashboard and Playwright queue for the `복이피는길` channel.

## Start locally

```powershell
cd D:\VibeCoding\auto_YT\web_ko
pnpm db:up
pnpm db:migrate
pnpm local:dev
```

In a second terminal, start the local worker controller:

```powershell
cd D:\VibeCoding\auto_YT
$env:PYTHONPATH = "D:\VibeCoding\auto_YT\src"
.\.venv\Scripts\python.exe -m auto_yt.ko_control_server
```

Open `http://127.0.0.1:3003`, then start the worker from the overview page.
`YT_Pro_Max` must already be available at `http://127.0.0.1:8000`.

## Verification

```powershell
pnpm test
pnpm lint
pnpm build
$env:KO_DB_INTEGRATION = "1"
pnpm vitest run lib/db/repo/integration.test.ts
```

The real end-to-end check is opt-in because it consumes the signed-in browser session:

```powershell
$env:KO_E2E_YOUTUBE_URL = "https://www.youtube.com/watch?v=..."
pnpm test:e2e
```

The model-selector smoke test does not send a prompt, but it opens the fixed profile and verifies both exact effort controls:

```powershell
$env:PYTHONPATH = "D:\VibeCoding\auto_YT\src"
$env:KO_RUN_PLAYWRIGHT_SMOKE = "1"
..\.venv\Scripts\python.exe -m pytest ..\tests\test_ko_chatgpt_smoke.py -q
```

The worker fails closed if the ChatGPT web UI does not expose the exact `GPT-5.6 Sol` model and `High` effort.
