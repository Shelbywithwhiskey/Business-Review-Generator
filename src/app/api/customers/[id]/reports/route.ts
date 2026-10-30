import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getOrCreateDefaultTemplate, DEFAULT_QBR_SECTIONS } from "@/lib/templates";
import { computeComparison, computeHealthScore, computeLineItemUsage, evaluateRules } from "@/lib/analytics";
import { generateExecutiveSummary, generateSectionNarrative, generateRecommendation } from "@/lib/ai";
import { syncReadiness } from "@/lib/zuper/sync";

export const maxDuration = 300;

const schema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  type: z.enum(["MBR", "QBR", "HBR", "YBR"]).default("QBR"),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const readiness = await syncReadiness(customerId);
  if (!readiness.ready) return NextResponse.json({ error: readiness.reason }, { status: 409 });

  const range = { start: new Date(parsed.data.periodStart), end: new Date(parsed.data.periodEnd) };
  const template = await getOrCreateDefaultTemplate();
  const [comparison, lineItemUsage] = await Promise.all([
    computeComparison(customerId, range),
    computeLineItemUsage(customerId, range),
  ]);
  const health = computeHealthScore(comparison.current);
  const rules = evaluateRules(comparison.current, comparison);

  const report = await prisma.report.create({
    data: {
      customerId,
      templateId: template.id,
      type: parsed.data.type,
      periodStart: range.start,
      periodEnd: range.end,
      compareMode: "previous_period",
    },
  });

  await prisma.healthScore.create({
    data: { customerId, reportId: report.id, overallScore: health.overall, dimensionScores: health.dimensions },
  });

  const sectionsData: Record<string, unknown> = {
    executive_summary: { metrics: comparison.current, comparison: comparison.changePct, health },
    jobs_performance: comparison.current.jobs,
    invoice_performance: comparison.current.invoices,
    quotes_performance: comparison.current.quotes,
    parts_usage: lineItemUsage,
    technician_performance: comparison.current.technicianRankings,
    key_insights: comparison.current.insights,
    opportunities: rules,
  };

  for (const [order, section] of DEFAULT_QBR_SECTIONS.entries()) {
    const rule = rules.find((r) => sectionAppliesToRule(section.key, r.key));
    const [narrative, recommendation] = await Promise.all([
      section.key === "executive_summary"
        ? generateExecutiveSummary(comparison.current, comparison, health)
        : generateSectionNarrative(section.key, sectionsData[section.key]),
      rule ? generateRecommendation(section.key, rule) : Promise.resolve(null),
    ]);

    await prisma.reportSection.create({
      data: {
        reportId: report.id,
        sectionKey: section.key,
        order,
        contentJson: sectionsData[section.key] as any,
        narrativeText: narrative,
        recommendationText: recommendation,
      },
    });
  }

  return NextResponse.json({ reportId: report.id });
}

function sectionAppliesToRule(sectionKey: string, ruleKey: string): boolean {
  const map: Record<string, string[]> = {
    jobs_performance: ["cancellation_rate_increase", "technician_workload_concentration"],
    invoice_performance: ["invoice_aging_high"],
    quotes_performance: ["quote_conversion_low"],
    technician_performance: ["technician_workload_concentration"],
    opportunities: [
      "zuper_pay_opportunity",
      "inventory_low_stock",
      "dormant_licensed_seats",
      "high_value_customer_churn_risk",
      "customer_concentration_risk",
    ],
  };
  return map[sectionKey]?.includes(ruleKey) ?? false;
}
