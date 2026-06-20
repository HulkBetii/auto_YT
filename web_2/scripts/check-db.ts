import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();
async function main() {
  const sql = neon(dbUrl!);
  const videos = await sql`SELECT id, status, chosen_topic, created_at FROM ah_videos ORDER BY id DESC LIMIT 5`;
  console.log('Videos:', JSON.stringify(videos, null, 2));
  const jobs = await sql`SELECT id, video_id, stage, status, retry_count, created_at FROM ah_jobs ORDER BY id DESC LIMIT 5`;
  console.log('Recent jobs:', JSON.stringify(jobs, null, 2));
}
main().catch(console.error);
