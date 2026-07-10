import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json(
      { ok: false, error: "Missing DATABASE_URL" },
      { status: 500 },
    );
  }

  try {
    const rows = await db.execute(sql`SELECT 1 AS ok`);
    return NextResponse.json({ ok: true, db: rows.rows[0] });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
