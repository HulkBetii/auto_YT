import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();
const web2Url = env.split('\n').find(l => l.startsWith('WEB2_URL='))?.replace('WEB2_URL=', '').replace(/^["']|["']$/g, '').trim() ?? '';

async function main() {
  const sql = neon(dbUrl!);

  const [video] = await sql`INSERT INTO ah_videos (status, created_at, updated_at) VALUES ('s1_pending', NOW(), NOW()) RETURNING id, status`;
  console.log('Created video:', video);

  const [s1] = await sql`SELECT template FROM ah_prompt_versions WHERE prompt_key='S1' AND is_active=true`;
  const callbackUrl = web2Url ? web2Url + '/api/cron/process-jobs' : '';
  const meta = JSON.stringify({web_callback_url: callbackUrl});

  const [job] = await sql`INSERT INTO ah_jobs (video_id, stage, status, prompt_text, metadata, created_at) VALUES (${video.id}, 'S1', 'pending', ${s1?.template ?? ''}, ${meta}, NOW()) RETURNING id, stage`;
  console.log('Enqueued S1 job:', job);
  console.log('Video #' + video.id + ' created!');
}
main().catch(console.error);
