import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();

async function main() {
  const sql = neon(dbUrl!);
  
  // Get job 20 prompt
  const rows = await sql`SELECT id, prompt_text FROM ah_jobs WHERE id=20`;
  const job = rows[0];
  if (!job) { console.log('Job 20 not found'); return; }
  
  const prompt = job.prompt_text as string;
  console.log(`Current prompt length: ${prompt.length}`);
  
  // Find the timestamped script section and sample every other line
  const tsStart = prompt.indexOf('[00:');
  if (tsStart === -1) { console.log('No timestamp found'); return; }
  
  const header = prompt.slice(0, tsStart);
  const tsSection = prompt.slice(tsStart);
  const lines = tsSection.split('\n');
  console.log(`Transcript lines: ${lines.length}`);
  
  // Sample every other line
  const sampled = lines.filter((_, i) => i % 2 === 0);
  const newPrompt = header + sampled.join('\n');
  console.log(`New prompt length: ${newPrompt.length}`);
  
  await sql`UPDATE ah_jobs SET prompt_text=${newPrompt}, status='pending', retry_count=0, started_at=NULL WHERE id=20`;
  console.log('Job 20 updated with trimmed prompt');
}
main().catch(console.error);
