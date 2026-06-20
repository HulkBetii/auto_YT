import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
const env = readFileSync(".env.local", "utf-8");
const dbUrl = env.split("\n").find(l => l.startsWith("DATABASE_URL="))?.replace("DATABASE_URL=", "").replace(/^["']|["']$/g, "").trim();
const sql = neon(dbUrl!);
(async () => {
  const r = await sql`
    UPDATE ah_jobs
    SET status = 'done', consumed_at = NOW(), finished_at = NOW(), error_message = 'duplicate S3 — manually cancelled'
    WHERE id = 37
    RETURNING id, status, consumed_at
  `;
  console.log("Updated:", r);
})().catch(console.error);
