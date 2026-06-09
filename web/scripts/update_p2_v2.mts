import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

// Fetch current active P2
const [p2] = await sql`
  SELECT id, version, template FROM prompt_versions
  WHERE prompt_key = 'P2' AND is_active = true
  ORDER BY version DESC LIMIT 1
`;

if (!p2) {
  console.error("❌ No active P2 prompt found");
  process.exit(1);
}

console.log(`Found active P2 v${p2.version} (id=${p2.id})`);

const OLD_TEXT = "動画の長さ：8〜10分（目標文字数：2200〜2800文字）";
const NEW_TEXT = "動画の長さ：10〜13分（目標文字数：3000〜3500文字）";

if (!p2.template.includes(OLD_TEXT)) {
  console.error(`❌ Target text not found in P2 v${p2.version} template.`);
  console.error(`Looking for: "${OLD_TEXT}"`);
  // Show context around word count mentions
  const lines = (p2.template as string).split("\n").filter((l: string) => l.includes("文字") || l.includes("分"));
  console.log("\nLines with 文字/分 in current template:");
  lines.forEach((l: string) => console.log("  ", l));
  process.exit(1);
}

const newTemplate = (p2.template as string).replace(OLD_TEXT, NEW_TEXT);

// Deactivate current P2
await sql`UPDATE prompt_versions SET is_active = false WHERE prompt_key = 'P2' AND is_active = true`;

// Insert new version
const [row] = await sql`
  INSERT INTO prompt_versions (prompt_key, version, template, is_active)
  SELECT 'P2', COALESCE(MAX(version), 0) + 1, ${newTemplate}, true
  FROM prompt_versions WHERE prompt_key = 'P2'
  RETURNING id, version
`;
console.log(`✓ P2 v${row.version} (id=${row.id}) activated`);
console.log(`\nChange: "${OLD_TEXT}"`);
console.log(`    → "${NEW_TEXT}"`);
process.exit(0);
