import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();
async function main() {
  const sql = neon(dbUrl!);
  const r = await sql`UPDATE ah_videos SET audio_url=NULL, updated_at=NOW() WHERE id=5 AND audio_url='tts_submitting' RETURNING id, status, audio_url`;
  console.log('Reset:', r);
}
main().catch(console.error);
