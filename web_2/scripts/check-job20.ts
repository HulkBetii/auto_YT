import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();
async function main() {
  const sql = neon(dbUrl!);
  const rows = await sql`SELECT id, stage, status, retry_count, length(prompt_text) as prompt_len FROM ah_jobs WHERE id=20`;
  console.log('Job 20:', JSON.stringify(rows, null, 2));
}
main().catch(console.error);
