/**
 * Minimal `[PLACEHOLDER]` interpolation — the prompts use bracketed tokens
 * (see 哲人の刻_Master_Prompts.md), not Handlebars/mustache, so a full
 * templating engine would be unused complexity. Missing keys are left as-is
 * so a malformed prompt is visible in the snapshot rather than silently blank.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\[([A-Z_][A-Z0-9_]*)\]/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
}
