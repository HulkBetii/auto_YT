import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();
async function main() {
  const sql = neon(dbUrl!);
  // Reset video 5 to tts_pending and clear stuck audio_url
  const r = await sql`
    UPDATE ah_videos 
    SET status='tts_pending', audio_url=NULL, updated_at=NOW()
    WHERE id=5 AND status='needs_attention'
    RETURNING id, status`;
  console.log('Reset video 5:', r);
}
main().catch(console.error);
