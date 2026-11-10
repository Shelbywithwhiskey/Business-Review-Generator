import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Supabase pauses a free project after a week without activity. Vercel Cron calls this every few days
// (see vercel.json) and it reads a real table so the project counts as active. Vercel sends
// `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set; it returns nothing but ok/not ok.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    await prisma.customer.count();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Keep-alive query failed", err);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
