export function verifyCronAuth(request: Request): boolean {
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected) return true;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}
