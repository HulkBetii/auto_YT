import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "DASHBOARD_SECRET not configured" }, { status: 500 });

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");

  if (password !== secret) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", next);
    url.searchParams.set("error", "1");
    return NextResponse.redirect(url, { status: 303 });
  }

  const response = NextResponse.redirect(new URL(next || "/", request.url), { status: 303 });
  response.cookies.set("dashboard_auth", secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
