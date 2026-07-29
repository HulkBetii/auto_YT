import { cookies } from "next/headers";

export async function assertStudyAuth(request: Request): Promise<boolean> {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return true;
  const cookieStore = await cookies();
  const auth = cookieStore.get("dashboard_auth")?.value;
  const bearer = request.headers.get("authorization");
  return auth === secret || bearer === `Bearer ${secret}`;
}
