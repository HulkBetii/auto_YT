# Windows transfer guide

This project is split into three local Next.js apps:

| App | Folder | App URL | Local Postgres port |
| --- | --- | --- | --- |
| web | `web` | `http://localhost:3000` | `5434` |
| web_2 | `web_2` | `http://localhost:3001` | `5435` |
| web_3 | `web_3` | `http://localhost:3002` | `5433` |

## What has been prepared

Use this command on the current Mac to create a Windows transfer zip:

```bash
./scripts/create-windows-transfer.sh
```

The zip is written to `_transfer/`. It includes source code, lockfiles, Docker files, and the current `.env.local` files. It excludes heavyweight/generated folders such as `node_modules`, `.next`, `.git`, build output, logs, and cache folders.

Treat the zip as private because it contains API keys from `.env.local`.

## Install on Windows

Install these first:

1. Git for Windows
2. Node.js 20 LTS or newer
3. Docker Desktop
4. pnpm via Corepack

In PowerShell:

```powershell
corepack enable
corepack prepare pnpm@latest --activate
docker --version
node --version
pnpm --version
```

Extract the zip, then open PowerShell in the extracted `auto_YT` folder.

## First run

Run each app from its own folder.

For `web`:

```powershell
cd web
pnpm install
pnpm db:up
pnpm db:migrate
pnpm local:dev
```

For `web_2` in another PowerShell window:

```powershell
cd web_2
pnpm install
pnpm db:up
pnpm db:migrate
pnpm local:dev
```

For `web_3` in another PowerShell window:

```powershell
cd web_3
pnpm install
pnpm db:up
pnpm db:migrate
pnpm local:dev
```

## Verification

Open these URLs after the dev servers start:

- `http://localhost:3000`
- `http://localhost:3001`
- `http://localhost:3002`

Optional checks:

```powershell
cd web
pnpm lint
pnpm build

cd ../web_2
pnpm lint
pnpm build
pnpm test

cd ../web_3
pnpm lint
pnpm build
pnpm test
```

## Local database data

The transfer zip moves the project files, not Docker volume data. If you need the exact existing local database rows from this Mac, export each database separately before moving machines.

If current local data is not important, skip this section and let `pnpm db:migrate` create fresh local databases on Windows.

## Known issue to check before first Windows run

`web/docker-compose.yml` and `web_2/docker-compose.yml` reference this init file:

```text
docker/postgres/001-enable-vector.sql
```

If Docker reports that this file is missing, create it inside the affected app folder with:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

