import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateEbrPptx } from "@/lib/pptx/ebrExport";
import type { AccountBrief } from "@/lib/reports/accountBrief";
import { syncReadiness } from "@/lib/zuper/sync";

/** The customer's data isn't in a finished state (no completed sync, or one still running). */
export class SyncNotReadyError extends Error {}

export const BRIEF_SECTION_KEY = "account_brief";

const REPORT_TITLES: Record<string, string> = {
  QBR: "Quarterly Business Review",
  MBR: "Monthly Business Review",
  HBR: "Half-Year Business Review",
};

/**
 * Builds a report's EBR deck and stores its Account Brief on the report (as the "account_brief"
 * section), so the report page shows the same brief the deck carries. Null when the report doesn't exist.
 */
export async function buildReportDeck(reportId: string): Promise<{ buffer: Buffer; filename: string; brief: AccountBrief } | null> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { customer: { select: { id: true, name: true, website: true, notes: true, testExclusions: true } } },
  });
  if (!report) return null;
  const readiness = await syncReadiness(report.customer.id);
  if (!readiness.ready) throw new SyncNotReadyError(readiness.reason);

  const { buffer, brief } = await generateEbrPptx({
    customerId: report.customer.id,
    customerName: report.customer.name,
    customerWebsite: report.customer.website,
    about: report.customer.notes,
    testExclusions: report.customer.testExclusions,
    range: { start: report.periodStart, end: report.periodEnd },
    reportTitle: REPORT_TITLES[report.type] ?? "Business Review",
  });

  const contentJson = brief as unknown as Prisma.InputJsonValue;
  await prisma.reportSection.upsert({
    where: { reportId_sectionKey: { reportId, sectionKey: BRIEF_SECTION_KEY } },
    // Order -1: shown above the generated narrative sections.
    create: { reportId, sectionKey: BRIEF_SECTION_KEY, order: -1, contentJson, narrativeText: brief.businessRead },
    update: { contentJson, narrativeText: brief.businessRead },
    select: { id: true },
  });

  const filename = `${report.customer.name.trim().replace(/[^a-z0-9]+/gi, "_")}_EBR_${new Date(report.periodEnd).toISOString().slice(0, 10)}.pptx`;
  return { buffer, filename, brief };
}
