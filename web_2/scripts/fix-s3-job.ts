import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();
type Topic = { title?: string };

async function main() {
  const sql = neon(dbUrl!);
  
  const [v] = await sql`SELECT whisper_transcript, chosen_topic FROM ah_videos WHERE id=5`;
  const transcript: string = v.whisper_transcript ?? '';
  const topic = ((typeof v.chosen_topic === 'string' ? JSON.parse(v.chosen_topic) : v.chosen_topic) ?? {}) as Topic;
  const topicTitle = topic.title ?? '';
  
  console.log(`Transcript: ${transcript.length} chars, Topic: ${topicTitle}`);
  
  const [s3] = await sql`SELECT template FROM ah_prompt_versions WHERE prompt_key='S3' AND is_active=true`;
  const promptText = (s3.template as string)
    .replace('[TIMESTAMPED_SCRIPT]', transcript)
    .replace('[TOPIC_TITLE]', topicTitle);
  
  console.log(`New S3 prompt: ${promptText.length} chars`);
  
  await sql`UPDATE ah_jobs SET status='pending', prompt_text=${promptText}, started_at=NULL, retry_count=0 WHERE id=20`;
  console.log('Job #20 reset with S3 v5 prompt');
}
main().catch(console.error);
