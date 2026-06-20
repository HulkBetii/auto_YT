import { neon } from '@neondatabase/serverless';
import { readFileSync, writeFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL='))?.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();
async function main() {
  const sql = neon(dbUrl!);
  const [row] = await sql`SELECT script FROM ah_videos WHERE id=5`;
  // Write script to file for use in curl
  writeFileSync('/tmp/script_v5.txt', row.script as string);
  console.log('Script written, length:', (row.script as string).length);
}
main().catch(console.error);
