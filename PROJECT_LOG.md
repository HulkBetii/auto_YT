# SYSTEM LOG — Auto-Pipeline

Core operations index and status log for the dual-channel automated YouTube content pipelines. 

> **Architecture**
> Monorepo structure containing two Next.js/Vercel dashboards (`web` for 哲人の刻, `web_2` for Ancient Humans) and a unified Python Playwright worker (`src/auto_yt`) bridging the `jobs` queues in Neon Postgres.

---

## 1. System Status

**Platform Services**
- **Dashboard 1 (哲人の刻):** `web/` — Deployed on Vercel. 
- **Dashboard 2 (Ancient Humans):** `web_2/` — Deployed on Vercel.
- **Worker (Mac Local):** `src/auto_yt/` — Running. Listens to `jobs` and `ah_jobs` using ChatGPT web automation.
- **Database:** Neon Postgres (Shared across both Next.js apps, separate schema contexts where applicable).
- **TTS Engine:** AI33.PRO Vivoo V3 (Legacy/Primary), Genmax & OpenAI (Secondary, introduced 2026-06-16).

**Orchestration & Cron**
*Vercel Hobby tier limitations require external chronometers for real-time polling.*
- **GitHub Actions (`.github/workflows/`):** 
  - `cron-process-jobs.yml` / `cron-ah-process-jobs.yml` (Runs `*/5 * * * *`)
  - `cron-check-worker.yml` (Runs `*/10 * * * *`)
  - `cron-check-analytics.yml` (Runs `0 */6 * * *`)
- **Vercel Native:** 
  - `evaluate-rollback` (Daily at 03:00)
  - `generate-topics` (Weekly on Mon 00:00)

**Integration & Keys**
| Service | Environment Var | Status |
| :--- | :--- | :--- |
| **Neon** | `DATABASE_URL` | Active |
| **OpenAI** | `OPENAI_API_KEY` | Active (Embeddings & TTS) |
| **YouTube** | `YOUTUBE_API_KEY` | Active (Analytics parsing) |
| **Telegram** | `TELEGRAM_BOT_TOKEN` | Active (Bot: `@rp_yt_bot`) |
| **Auth** | `DASHBOARD_SECRET` | Active |

---

## 2. Infrastructure Updates

**June 2026 Rollouts**
- **Genmax TTS Integration (06-16):** Implemented Genmax as a secondary TTS provider. Updated polling pattern to fire-and-poll without blocking serverless execution durations.
- **Atomic TTS Tasks (06-16):** Added atomic `task_id` locking to prevent duplicate TTS submissions across overlapping cron ticks.
- **Pipeline Stepper (06-16):** Introduced 7-step pipeline UI stepper on `web_2` for enhanced assembly observability.
- **Dashboard Service Toggles (06-17):** Added live pipeline service status indicators and manual per-service toggles on the dashboard.
- **Schema Validation (06-17):** Hardened `web_2` schema guards, including rank validation and data cleanup hooks.

---

## 3. Notable Incidents & Mitigations

### 3.1. Pipeline Re-entrancy Crash (Resolved)
**Issue:** When cron `process-jobs` executed handlers (like `handleP2Done`), any partial crash prior to the final `consumed_at` timestamping caused the next cron tick to restart the handler. This duplicated downstream jobs (`enqueueStage`), resulting in double-scoring and duplicate content pipelines.
**Fix:** Introduced the `causedByJobId` guard.
- `enqueueStage` now receives the parent job ID and performs an atomic lookup (`findJobByCause`).
- Prevents creation of identical downstream operations originating from the same crashed parent iteration.
- Identical outputs from retry-loops skip redundant DB writes in `saveVideoContent`.

### 3.2. Empty Topic Batch (Resolved)
**Issue:** System initialized with 0 videos and 0 jobs because the initial `generate-topics` P1 schedule had never run.
**Fix:** Explicitly triggered batch initialization. Added system logic to handle empty boundaries safely.

### 3.3. Playwright Terminal Timeout (Mitigated)
**Issue:** Hard timeouts during Playwright execution against ChatGPT elements (e.g. `#prompt-te`) would permanently block job progression without graceful degradation.
**Fix:** Generic timeout exceptions are logged as hard-fails requiring manual intervention via the Dashboard's `Needs Attention` queue, rather than infinite loops. Recovery involves executing `/api/jobs/[id]/retry` manually.

---

## 4. Diagnostics Toolkit

Diagnostic scripts are isolated in the respective `scripts/` directories. Execute using `tsx`.

**Key Scripts (`web/scripts/`)**
- `check_pipeline.mts` — Holistic view of pipeline state.
- `check_stuck.mts` — Detect orphaned or hanging jobs.
- `check_tts_state.mts` — Audit Vivoo/Genmax polling queues.
- `reset_stuck_job.mts` — Force-reset jobs locked by crashed workers.
- `run_tts_all.mts` — Batch dispatch audio synthesis.

**Key Scripts (`web_2/scripts/`)**
- `check-status.ts` — View pipeline state for Ancient Humans.
- `fix-stuck-job.ts` — Resolve lock conditions on AH jobs.
- `reset-tts.ts` — Drop current audio and requeue TTS.

