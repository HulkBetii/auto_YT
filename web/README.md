# auto_YT Web — Next.js Orchestrator

Next.js App Router application that owns the Neon Postgres schema, dashboard, cron routes, and pipeline orchestration for the **哲人の刻** YouTube production workflow.

The browser automation itself does **not** run inside Vercel. It is handled by the Python worker in `../src/auto_yt/worker.py`, which communicates with this app only through the `jobs` table.

## Responsibilities

- Store videos, stage outputs, prompt versions, analytics snapshots, settings, and jobs in Neon Postgres.
- Create and chain prompt jobs for `P1`, `P2`, `P3`, `P4`, `P_score`, `P5`, and `P6`.
- Process completed worker jobs and advance the pipeline state machine.
- Run cron checks for analytics, P6 batch readiness, prompt rollback, and worker heartbeat.
- Provide internal dashboard pages for videos, prompt versions, settings, and attention queues.

## Tech Stack

- Next.js 16 App Router
- React 19
- Drizzle ORM
- Neon Postgres + pgvector
- OpenAI API for embeddings
- YouTube Data API v3 for public video stats
- Vercel Cron
- Telegram notifications

## Environment Variables

Create `web/.env.local` locally and configure the same keys in Vercel production:

```bash
DATABASE_URL="postgresql://..."
OPENAI_API_KEY="..."
YOUTUBE_API_KEY="..."
DASHBOARD_SECRET="..."
TELEGRAM_BOT_TOKEN="..."
TELEGRAM_CHAT_ID="..."
```

Notes:

- `DASHBOARD_SECRET` protects dashboard pages via cookie auth and cron routes via `Authorization: Bearer ...`.
- `TELEGRAM_*` can be empty in local dev, but production alerts will be dropped until configured.
- YouTube CTR and average-view-duration are not available from the Data API key; those are entered manually through the dashboard.

## Commands

```bash
pnpm install
pnpm dev
pnpm lint
pnpm build
```

Drizzle commands are run through `drizzle-kit` using `drizzle.config.ts`:

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

Use the exact package-manager style already present in this directory (`pnpm-lock.yaml`).

## Database Tables

Main tables:

- `videos` — one planned/produced YouTube video and its state.
- `video_content` — raw ChatGPT output for each stage.
- `video_analytics` — YouTube Data API snapshots plus manual CTR/AVD fields.
- `prompt_versions` — full version history for P1..P6 and P_score.
- `jobs` — queue contract between this app and the Python worker.
- `channel_config` — settings plus worker heartbeat row.

Important indexes are defined in migrations, including pgvector similarity search and the partial unique index that keeps exactly one active prompt version per key.

## Pipeline Flow

1. A P1 job produces candidate topics.
2. `process-jobs` consumes completed P1 output, filters duplicates, creates `videos`, then enqueues P2.
3. P2 → P3 → P4 are chained one video at a time.
4. P4 completion combines outline/script/SEO and enqueues `P_score`.
5. `P_score >= score_threshold` marks the video `ready_to_publish`; otherwise it retries P3 up to `max_content_retries`, then flags `needs_attention`.
6. Published videos get YouTube stats through `check-analytics`; once view/CTR/AVD requirements are met, P5 is enqueued.
7. Every `p6_batch_size` analyzed videos, P6 reviews performance and can create a new active P1 prompt version.
8. `evaluate-rollback` compares old vs new prompt batches and can roll back P1 if CTR degradation crosses threshold.

## Cron Routes

Defined in `vercel.json`:

- `/api/cron/process-jobs` — every minute; consumes completed/failed jobs and chains pipeline.
- `/api/cron/check-analytics` — every 6 hours; refreshes YouTube stats, triggers P5/P6.
- `/api/cron/evaluate-rollback` — daily; checks prompt performance degradation.
- `/api/cron/check-worker` — every 10 minutes; alerts only if worker was `running` and heartbeat is stale.

Manual local call example:

```bash
curl -H "Authorization: Bearer $DASHBOARD_SECRET" http://localhost:3000/api/cron/process-jobs
```

## Dashboard Pages

- `/` — overview.
- `/videos` and `/videos/[id]` — video pipeline state, content, YouTube ID, analytics input.
- `/prompts` and `/prompts/[key]` — prompt version history, activate old versions.
- `/needs-attention` — failed jobs, missing analytics, retry actions.
- `/settings` — editable `channel_config` settings.

## Validation

Before committing changes under `web/`:

```bash
pnpm lint
pnpm build
```

Current known-good state: both commands pass locally.
