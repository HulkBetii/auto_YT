# Local Postgres Workflow

Daily local workflow uses Docker Postgres instead of Neon.

| App | App URL | DB URL | Compose service |
| --- | --- | --- | --- |
| `web` | `http://localhost:3000` | `localhost:5434/web` | `web-postgres` |
| `web_2` | `http://localhost:3001` | `localhost:5435/web2` | `web2-postgres` |
| `web_3` | `http://localhost:3002` | `localhost:5433/web3` | `web3-postgres` |

## Start One App

```powershell
cd D:\VibeCoding\auto_YT\<app>
corepack pnpm db:up
corepack pnpm db:migrate
corepack pnpm local:dev
```

## Health Checks

```powershell
Invoke-WebRequest http://localhost:3000/api/health
Invoke-WebRequest http://localhost:3001/api/health
Invoke-WebRequest http://localhost:3002/api/health
```

Each healthy app returns `{"ok":true,"db":{"ok":1}}`.

## Stop One App DB

```powershell
corepack pnpm db:down
```

## Data Recovery Later

Local databases start empty. When the old Neon databases are available again, dump each Neon database and restore into the matching local Postgres database.

## Legacy Scripts

Some one-off scripts under `web/scripts` and `web_2/scripts` still import the Neon HTTP client. Treat them as legacy/debug scripts unless they are migrated to the local `pg` driver for active use.


