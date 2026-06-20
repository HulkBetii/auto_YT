import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
const env = readFileSync(".env.local", "utf-8");
const dbUrl = env.split("\n").find(l => l.startsWith("DATABASE_URL="))?.replace("DATABASE_URL=", "").replace(/^["']|["']$/g, "").trim();
const sql = neon(dbUrl!);
(async () => {
  const r = await sql`
    UPDATE ah_videos SET status = 'ready', updated_at = NOW()
    WHERE id = 10 RETURNING id, status
  `;
  console.log("Reset:", r);
})().catch(console.error);
