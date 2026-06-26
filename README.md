# auto_YT — 哲人の刻 Auto-Pipeline

Internal YouTube production pipeline for the channel **哲人の刻**. The system replaces the manual 6-prompt workflow with a DB-backed orchestrator and a local Playwright worker.

## Architecture

```text
web/ Next.js dashboard + API routes + Vercel Cron
  ├─ owns Neon Postgres schema via Drizzle
  ├─ creates/chains jobs for P1 → P2 → P3 → P4 → P_score → P5/P6
  ├─ pulls YouTube Data API stats
  └─ monitors worker heartbeat + sends Telegram alerts

src/auto_yt/ Python Playwright worker
  ├─ polls jobs table with SELECT ... FOR UPDATE SKIP LOCKED
  ├─ sends prompt_text through ChatGPT web UI
  └─ writes result/error back to jobs
```

The **only contract** between the web app and Python worker is the `jobs` table in Neon Postgres.

## Current Status

See `PROJECT_LOG.md` for the full phase history. As of 2026-06-08:

- DB schema, prompt versioning, queue, worker loop, pipeline chaining, anti-duplication, scoring, P5/P6, rollback logic, dashboard, cron routes, and worker monitoring are implemented.
- `web` build and lint pass locally.
- Remaining production work is operational: deploy Vercel env vars, keep the Mac worker running, and verify Telegram credentials.

## Repository Layout

```text
auto_YT/
├── PROJECT_LOG.md              # authoritative project status/history
├── README.md                   # this overview
├── requirements.txt            # Python worker/UI deps
├── run_app.py                  # legacy/local ChatGPT login UI
├── config/                     # non-secret templates
├── data/                       # gitignored local secrets, sessions, Chrome profiles
├── src/auto_yt/
│   ├── worker.py               # production Playwright worker loop
│   ├── services/
│   │   ├── chat_gpt.py         # send prompt + extract ChatGPT response
│   │   ├── chatgpt_login.py    # login/session restore
│   │   ├── database.py         # small Postgres helper for tests
│   │   └── job_queue.py        # Python side of jobs contract
│   └── ui/                     # legacy/manual profile UI
├── tests/                      # e2e scripts for login/chat/Postgres
└── web/                        # Next.js/Vercel app
```

## Setup

### Python worker

```bash
cd /Users/sangspm/Downloads/VibeCoding/auto_YT
pip install -r requirements.txt
python -m playwright install chromium
```

Local secret files expected under `data/`:

- `data/account.json` — ChatGPT account/session cookies.
- `data/db_config.json` — fallback `DATABASE_URL` for the Python worker if env var is not set.

### Web app

```bash
cd /Users/sangspm/Downloads/VibeCoding/auto_YT/web
pnpm install
cp .env.local.example .env.local  # if an example exists; otherwise create manually
pnpm lint
pnpm build
```

Required `web/.env.local` keys:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `YOUTUBE_API_KEY`
- `DASHBOARD_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Running Locally

### 1. Start the web dashboard

```bash
cd /Users/sangspm/Downloads/VibeCoding/auto_YT/web
pnpm dev
```

Open `http://localhost:3000`. If `DASHBOARD_SECRET` is set, login with that value.

### 2. Start the Python worker

In another terminal:

```bash
cd /Users/sangspm/Downloads/VibeCoding/auto_YT
PYTHONPATH=src python -m auto_yt.worker
```

The worker records heartbeat in `channel_config.worker_heartbeat`.

### 3. Run orchestration manually

In production, Vercel Cron calls these routes. Locally, call them with Bearer auth when `DASHBOARD_SECRET` is set:

```bash
curl -H "Authorization: Bearer $DASHBOARD_SECRET" http://localhost:3000/api/cron/process-jobs
curl -H "Authorization: Bearer $DASHBOARD_SECRET" http://localhost:3000/api/cron/check-analytics
curl -H "Authorization: Bearer $DASHBOARD_SECRET" http://localhost:3000/api/cron/evaluate-rollback
curl -H "Authorization: Bearer $DASHBOARD_SECRET" http://localhost:3000/api/cron/check-worker
```

## Operational Notes

- ChatGPT session cookies are session cookies, so the UI/worker also stores cookies in `data/account.json` and injects them on restore.
- If ChatGPT shows device verification, complete it once manually in the persistent profile.
- YouTube CTR and average-view-duration require YouTube Analytics OAuth and are currently entered manually in the dashboard; Data API key only provides view/like/comment counts.
- Vercel Cron does not run the browser worker. The Mac worker must stay awake while jobs are expected to progress.

## Validation Commands

```bash
cd /Users/sangspm/Downloads/VibeCoding/auto_YT/web
pnpm lint
pnpm build

cd /Users/sangspm/Downloads/VibeCoding/auto_YT
python3 -m py_compile src/auto_yt/worker.py src/auto_yt/services/*.py
```
