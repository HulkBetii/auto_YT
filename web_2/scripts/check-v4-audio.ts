import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();
async function main() {
  const sql = neon(dbUrl!);
  const v = await sql`SELECT id, audio_url, voice_id, script FROM ah_videos WHERE id=4`;
  const vid = v[0];
  console.log('audio_url:', vid.audio_url);
  console.log('voice_id:', vid.voice_id);
  console.log('script length:', vid.script?.length);
}
main().catch(console.error);
