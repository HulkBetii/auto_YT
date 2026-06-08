/**
 * Lightweight structured logging — single-line JSON to stdout, captured by
 * Vercel's log pipeline. A dedicated `logs` table was explicitly considered and
 * rejected as YAGNI: `jobs`/`video_content`/`prompt_versions` already provide a
 * durable audit trail, and these console lines are for live tailing/grepping.
 */
export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields, ts: new Date().toISOString() }));
}
