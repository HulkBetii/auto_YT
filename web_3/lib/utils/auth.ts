export function verifyCronAuth(request: Request): boolean {
  const allowedSecrets = [
    process.env.CRON_SECRET,
    process.env.DASHBOARD_SECRET,
  ].filter(Boolean);
  if (allowedSecrets.length === 0) return true;

  const authorization = request.headers.get("authorization");
  return allowedSecrets.some((secret) => authorization === `Bearer ${secret}`);
}
