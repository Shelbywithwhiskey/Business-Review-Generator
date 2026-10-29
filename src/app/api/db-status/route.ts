import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailable } from "@/lib/dbStatus";

export const dynamic = "force-dynamic";

// One `SELECT 1` so the UI can say plainly when the database is down instead of rendering empty pages.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Database status check failed", err);
    const message = isDatabaseUnavailable(err) ? DB_UNAVAILABLE_MESSAGE : "The database returned an error.";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
