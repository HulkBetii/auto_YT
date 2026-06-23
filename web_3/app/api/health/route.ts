import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json(
      { ok: false, error: "Missing DATABASE_URL" },
      { status: 500 },
    );
  }

  try {
    const sql = neon(databaseUrl);
    const rows = await sql`SELECT 1 AS ok`;
    return NextResponse.json({ ok: true, db: rows[0] });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
