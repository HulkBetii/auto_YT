# Local Postgres Runbook

`web_3` is intended to run locally with Docker Postgres for daily dashboard and pipeline work. Vercel/Neon can remain as a fallback, but local is the primary workflow.

## Prerequisites

- Docker Desktop is running.
- Dependencies are installed with `pnpm install`.

## Start

```powershell
cd D:\VibeCoding\auto_YT\web_3
corepack pnpm db:up
corepack pnpm db:migrate
corepack pnpm local:dev
```

Open the dashboard at:

```text
http://localhost:3002
```

## Health Check

```powershell
Invoke-WebRequest http://localhost:3002/api/health
```

Expected response:

```json
{"ok":true,"db":{"ok":1}}
```

## Stop

```powershell
corepack pnpm db:down
```

## Database

Default local connection string:

```text
postgresql://web3:web3_local_password@localhost:5433/web3
```

Data is stored in the Docker volume `web3_postgres_data`.

## Neon Data Recovery Later

The local database starts empty. When the old Neon project is available again, dump the Neon database and restore it into this local Postgres instance.


