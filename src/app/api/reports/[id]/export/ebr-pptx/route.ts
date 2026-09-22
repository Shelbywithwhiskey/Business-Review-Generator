import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateEbrPptx } from "@/lib/pptx/ebrExport";

export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = await prisma.report.findUnique({
    where: { id },
    include: { customer: { select: { id: true, name: true } } },
  });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const reportTitle = report.type === "QBR" ? "Quarterly Business Review" : "Executive Business Review";

  const buffer = await generateEbrPptx({
    customerId: report.customer.id,
    customerName: report.customer.name,
    range: { start: report.periodStart, end: report.periodEnd },
    reportTitle,
  });

  const filename = `${report.customer.name.replace(/[^a-z0-9]+/gi, "_")}_EBR_${new Date(report.periodEnd).toISOString().slice(0, 10)}.pptx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
