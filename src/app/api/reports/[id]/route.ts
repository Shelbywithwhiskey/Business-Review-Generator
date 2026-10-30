import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncReadiness } from "@/lib/zuper/sync";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true } },
      sections: { orderBy: { order: "asc" } },
    },
  });
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The deck and brief need a finished sync; the page disables them (with the reason) otherwise.
  return NextResponse.json({ report, sync: await syncReadiness(report.customerId) });
}
