import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

const rows = await sql`
  SELECT id, stage, status, video_id, started_at, finished_at,
         left(error_message, 100) as error_message
  FROM jobs
  WHERE id >= 130
  ORDER BY id DESC
  LIMIT 20
`;

for (const j of rows) {
  const start = j.started_at ? new Date(j.started_at as string) : null;
  const fin   = j.finished_at ? new Date(j.finished_at as string) : null;
  const dur   = start && fin ? `${Math.round((fin.getTime() - start.getTime()) / 1000)}s`
              : start ? "running…" : "queued";
  const err   = j.error_message ? `  ERR: ${j.error_message}` : "";
  console.log(`#${j.id} [${j.stage}] ${String(j.status).padEnd(8)} vid=${j.video_id ?? "—"} ${dur}${err}`);
}
process.exit(0);
