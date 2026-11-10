import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Clears everything synced or generated for one customer — Zuper records, metrics, reports and sync
 * history — but keeps the customer itself (name, website, notes, connection settings), so the next
 * review is just a fresh Sync. Frees database space on the free plan. Download decks first: a report
 * can't be re-exported until the account is synced again.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A sync writing rows while they're deleted would leave a half-filled account behind.
  const running = await prisma.syncRun.findFirst({
    where: { customerId: id, status: { in: ["PENDING", "RUNNING"] }, createdAt: { gte: new Date(Date.now() - 2 * 3600e3) } },
    select: { id: true },
  });
  if (running) return NextResponse.json({ error: "A sync is still running for this customer. Wait for it to finish, then try again." }, { status: 409 });

  const where = { customerId: id };
  const results = await prisma.$transaction([
    prisma.jobLineItem.deleteMany({ where }),
    prisma.job.deleteMany({ where }),
    prisma.invoice.deleteMany({ where }),
    prisma.quote.deleteMany({ where }),
    prisma.payment.deleteMany({ where }),
    prisma.technician.deleteMany({ where }),
    prisma.product.deleteMany({ where }),
    prisma.expense.deleteMany({ where }),
    prisma.timesheetEvent.deleteMany({ where }),
    prisma.endCustomerLedger.deleteMany({ where }),
    prisma.organization.deleteMany({ where }),
    prisma.property.deleteMany({ where }),
    prisma.project.deleteMany({ where }),
    prisma.workflow.deleteMany({ where }),
    prisma.workflowExecutionSnapshot.deleteMany({ where }),
    prisma.zuperRecord.deleteMany({ where }),
    prisma.moduleCoverage.deleteMany({ where }),
    prisma.metricSnapshot.deleteMany({ where }),
    prisma.healthScore.deleteMany({ where }),
    prisma.opportunitySignal.deleteMany({ where }),
    prisma.report.deleteMany({ where }), // report sections cascade
    prisma.syncRun.deleteMany({ where }),
    prisma.customer.update({ where: { id }, data: { testExclusions: Prisma.DbNull }, select: { id: true } }),
  ]);
  const removed = results.reduce((s, r) => s + ("count" in r ? r.count : 0), 0);
  return NextResponse.json({ ok: true, removed });
}
