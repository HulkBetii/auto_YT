import { cookies } from "next/headers";

export async function isDashboardAuthorized(request?: Request): Promise<boolean> {
  const secret = process.env.DASHBOARD_SECRET?.trim();
  if (!secret) return true;
  const cookieStore = await cookies();
  const cookie = cookieStore.get("dashboard_auth")?.value;
  const bearer = request?.headers.get("authorization");
  return cookie === secret || bearer === `Bearer ${secret}`;
}
