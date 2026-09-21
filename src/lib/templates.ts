import { prisma } from "@/lib/db";

export const DEFAULT_QBR_SECTIONS = [
  { key: "executive_summary", title: "Executive Summary" },
  { key: "jobs_performance", title: "Jobs Performance" },
  { key: "invoice_performance", title: "Invoice Performance" },
  { key: "technician_performance", title: "Technician Performance" },
  { key: "opportunities", title: "Opportunities" },
];

export async function getOrCreateDefaultTemplate() {
  const existing = await prisma.reportTemplate.findFirst({ where: { isDefault: true, type: "QBR" } });
  if (existing) return existing;
  return prisma.reportTemplate.create({
    data: {
      name: "Default QBR",
      type: "QBR",
      isDefault: true,
      sections: DEFAULT_QBR_SECTIONS,
    },
  });
}
