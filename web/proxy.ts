import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/api/auth", "/api/cron", "/api/health", "/_next", "/favicon.ico"];

/**
 * Single-internal-user gate for the dashboard. The same `DASHBOARD_SECRET` env
 * var also authenticates the cron routes (via Bearer header there); here it's
 * compared against a cookie set by /api/auth/login after a plain password form.
 * If the secret isn't configured (e.g. local dev), the gate is a no-op.
 */
export function proxy(request: NextRequest) {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (request.cookies.get("dashboard_auth")?.value === secret) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
