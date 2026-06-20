import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();
async function main() {
  const sql = neon(dbUrl!);
  // Reset running ah_jobs to pending
  const r = await sql`
    UPDATE ah_jobs SET status='pending', started_at=NULL 
    WHERE status='running' AND video_id=5
    RETURNING id, stage`;
  console.log('Reset jobs:', r);
  // Show video 5 state
  const v = await sql`SELECT id, status FROM ah_videos WHERE id=5`;
  console.log('Video 5:', v);
}
main().catch(console.error);
