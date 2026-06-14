export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\[([A-Z_][A-Z0-9_]*)\]/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
}
