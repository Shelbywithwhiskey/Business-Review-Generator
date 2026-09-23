import type { DateRange } from "@/lib/zuper/modules";
import { computeJobMetrics, computeLineItemUsage, computePaymentMetrics, type LineItemUsage } from "@/lib/analytics";
import {
  computeQuoteBreakdown,
  computeInvoiceBreakdown,
  computeTopJobCategories,
  computeFootprintComparison,
  computeQuarterlySeries,
  computeMonthlySeries,
  computeWorkflowSummary,
  computeRecommendationSignals,
  type WorkflowSummary,
} from "@/lib/reports/ebrMetrics";
import { computeExecutionDeepDive, computeSyncInfo, computeAccountActivityDates } from "@/lib/reports/moduleMetrics";
import { computeCatalogAnalyses, computeJobServiceDelivery } from "@/lib/reports/catalogMetrics";
import { generateBusinessRecommendations } from "@/lib/ai";
import { fetchWebsiteContext } from "@/lib/website";
import { niceAxisMax, type LineChartData } from "./chartData";
import { fmtInt, fmtMoneyCompact } from "./generatedSlide";
import type { SlideNotes } from "./slideNotes";
import { buildTemplateNotes } from "./templateNotes";

// ---------------------------------------------------------------------------
// Builds the {{TOKEN}} -> display-string map, chart datasets, text fix-ups and
// speaker notes for templates/ebr-template.pptx (consumed by ebrExport.ts).
// Token names here MUST match the ones baked into the template by
// scripts/tokenize-qbr-template.mjs.
// ---------------------------------------------------------------------------

/** n is a 0-1 fraction. */
function fmtPctFraction(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

/** n is already on a 0-100 scale. */
function fmtPctScaled(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

function fmtCountK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : fmtInt(n);
}

function fmtDateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function fmtShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function fmtPeriodLabel(range: DateRange): string {
  return `${fmtDateLabel(range.start)} – ${fmtDateLabel(range.end)}`;
}

/** Replaces one <a:t> run of a template slide, by its position in the slide — applied only if the run
 * still reads `expect` (raw XML text), so a re-exported template can't get the wrong run overwritten. */
export interface RunFix {
  index: number;
  expect: string;
  text: string;
}

export interface EbrTokenData {
  tokens: Record<string, string>;
  charts: {
    chart1: LineChartData; // quote accepted/declined value by quarter
    chart2: LineChartData; // quote acceptance rate by quarter
    chart3: LineChartData; // invoice invoiced/collected value by quarter
    chart4: LineChartData; // invoice collection rate by quarter
    chart5: LineChartData; // monthly avg invoice value
    chart6: LineChartData; // monthly unaccepted quote value
  };
  /** Feed the generated (non-template) slides — see lib/pptx/usageSlide.ts and automationSlide.ts. */
  usage: LineItemUsage;
  workflowSummary: WorkflowSummary;
  periodLabel: string;
  /** Template slide path -> text runs to rewrite (hard-coded copy that must match this account's data). */
  fixups: Record<string, RunFix[]>;
  /** Template slide path -> speaker notes. */
  notes: Record<string, SlideNotes>;
}

export async function buildEbrTokenData(
  customerId: string,
  customerName: string,
  customerWebsite: string | null,
  range: DateRange,
  reportTitle: string
): Promise<EbrTokenData> {
  const [jobs, quotes, invoices, payments, topCategories, footprint, quarters, months, workflowSummary, websiteContext, usage, exec, sync, firsts] =
    await Promise.all([
      computeJobMetrics(customerId, range),
      computeQuoteBreakdown(customerId, range),
      computeInvoiceBreakdown(customerId, range),
      computePaymentMetrics(customerId, range),
      computeTopJobCategories(customerId, range, 3),
      computeFootprintComparison(customerId, range),
      computeQuarterlySeries(customerId, range, 4),
      computeMonthlySeries(customerId, range, 13),
      computeWorkflowSummary(customerId, range),
      customerWebsite ? fetchWebsiteContext(customerWebsite) : Promise.resolve(null),
      computeLineItemUsage(customerId, range),
      computeExecutionDeepDive(customerId, range),
      computeSyncInfo(customerId, range),
      computeAccountActivityDates(customerId),
    ]);
  const [delivery, catalog] = await Promise.all([computeJobServiceDelivery(customerId, range), computeCatalogAnalyses(customerId, range)]);
  const highlight = (module: string, label: string) =>
    Number(catalog.find((m) => m.key === module)?.highlights.find((h) => h.label.startsWith(label))?.value.replace(/[^\d.]/g, "") || 0);

  const [cat1, cat2, cat3] = topCategories;
  const periodLabel = fmtPeriodLabel(range);

  const jobPerformanceInsightParts = [
    cat1 ? `led by ${cat1.name} at ${fmtPctFraction(cat1.pct)}` : null,
    cat2 ? `followed by ${cat2.name} at ${fmtPctFraction(cat2.pct)}` : null,
    cat3 ? `and ${cat3.name} at ${fmtPctFraction(cat3.pct)}` : null,
  ].filter(Boolean);
  const jobPerformanceInsight = jobs.total
    ? `${fmtInt(jobs.completed)} of ${fmtInt(jobs.total)} jobs created this period are completed` +
      (jobPerformanceInsightParts.length ? `; job mix ${jobPerformanceInsightParts.join(", ")}.` : ".")
    : "No jobs were created in this period.";

  // Open quote value is pipeline to follow up on — never described as revenue (SPEC §14.5).
  const q22Insight = invoices.billable
    ? `Collections stand at ${fmtPctFraction(invoices.collectionRate)} of the ${fmtMoneyCompact(invoices.totalValue)} invoiced this period` +
      (quotes.open.value > 0 ? `, with ${fmtMoneyCompact(quotes.open.value)} in quotes still open — the biggest pipeline to follow up on.` : ".")
    : quotes.open.value > 0
      ? `No invoices were issued this period; ${fmtMoneyCompact(quotes.open.value)} in quotes is still open.`
      : "No invoices were issued this period.";

  const quarterLabels = quarters.map((q) => q.label);
  const quartersWithQuotes = quarters.filter((q) => q.quotesSent > 0);
  const quartersWithInvoices = quarters.filter((q) => q.invoicesInvoicedValue > 0);
  const lastQuarter = quarters[quarters.length - 1];
  const byRate = <T,>(xs: T[], rate: (x: T) => number) => [...xs].sort((a, b) => rate(a) - rate(b));

  let s23Insight: string;
  if (quartersWithQuotes.length) {
    const sorted = byRate(quartersWithQuotes, (q) => q.acceptanceRatePct);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    s23Insight =
      (low === high
        ? `Quote acceptance was ${fmtPctScaled(low.acceptanceRatePct)} in ${low.label}. `
        : `Quote acceptance ranged from ${fmtPctScaled(low.acceptanceRatePct)} in ${low.label} to ${fmtPctScaled(high.acceptanceRatePct)} in ${high.label}. `) +
      `${fmtInt(quotes.open.count)} quotes remain open, worth ${fmtMoneyCompact(quotes.open.value)}.`;
  } else {
    s23Insight = "No quotes were sent in the last four quarters, so there is no acceptance trend to show.";
  }

  const s23Recommendation =
    quotes.sent >= 5 && quotes.accepted.rate < 0.3
      ? `Acceptance is ${fmtPctFraction(quotes.accepted.rate)} — prioritize follow-up on aging quotes and use automated quote reminders on the ${fmtMoneyCompact(quotes.open.value)} still open.`
      : quotes.open.value > 0
        ? `Keep follow-up tight on the ${fmtInt(quotes.open.count)} open quotes (${fmtMoneyCompact(quotes.open.value)}); automated reminders help hold the acceptance rate.`
        : "No open quote pipeline to follow up on this period.";

  let s24Insight: string;
  if (quartersWithInvoices.length) {
    const sorted = byRate(quartersWithInvoices, (q) => q.collectionRatePct);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    s24Insight =
      (low === high
        ? `Collection rate was ${fmtPctScaled(low.collectionRatePct)} in ${low.label}. `
        : `Collection rate ranged from ${fmtPctScaled(low.collectionRatePct)} in ${low.label} to ${fmtPctScaled(high.collectionRatePct)} in ${high.label}. `) +
      `Invoiced value moved from ${fmtMoneyCompact(quarters[0].invoicesInvoicedValue)} (${quarters[0].label}) to ${fmtMoneyCompact(lastQuarter.invoicesInvoicedValue)} (${lastQuarter.label}).` +
      (lastQuarter.label === quarterLabels[quarterLabels.length - 1] && range.end < new Date(Date.UTC(range.end.getUTCFullYear(), Math.floor(range.end.getUTCMonth() / 3) * 3 + 3, 1))
        ? ` ${lastQuarter.label} is still in progress, so its collection rate will rise as invoices are paid.`
        : "");
  } else {
    s24Insight = "No invoices were issued in the last four quarters.";
  }

  // Trailing-13-month trend: compare the first vs last month with enough invoices for a stable average
  // (≥5), falling back to any month with invoices.
  const MIN_INVOICES = 5;
  const invoiceMonths = months.some((m) => m.invoiceCount >= MIN_INVOICES)
    ? months.filter((m) => m.invoiceCount >= MIN_INVOICES)
    : months.filter((m) => m.invoiceCount > 0);
  const firstInv = invoiceMonths[0];
  const lastInv = invoiceMonths[invoiceMonths.length - 1];
  const avgInvoicePctChange = firstInv && lastInv && firstInv !== lastInv && firstInv.avgInvoiceValue
    ? ((lastInv.avgInvoiceValue - firstInv.avgInvoiceValue) / firstInv.avgInvoiceValue) * 100
    : null;
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  const quoteValuePctChange = firstMonth.unacceptedQuoteValue
    ? ((lastMonth.unacceptedQuoteValue - firstMonth.unacceptedQuoteValue) / firstMonth.unacceptedQuoteValue) * 100
    : null;
  const acceptedQuoteValue13m = months.reduce((s, m) => s + m.acceptedQuoteValue, 0);
  const direction = (pct: number | null) => (pct == null ? "changed" : pct >= 0 ? "rose" : "fell");
  const signed = (pct: number | null) => (pct == null ? "n/a" : `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`);

  const s25Insight =
    (avgInvoicePctChange != null
      ? `Average invoice value ${direction(avgInvoicePctChange)} ${Math.abs(avgInvoicePctChange).toFixed(0)}% ($${fmtInt(firstInv.avgInvoiceValue)} in ${firstInv.label} → $${fmtInt(lastInv.avgInvoiceValue)} in ${lastInv.label})`
      : "Not enough months with invoices to show an average-invoice trend") +
    (quoteValuePctChange != null
      ? `; unaccepted quote value ${direction(quoteValuePctChange)} ${Math.abs(quoteValuePctChange).toFixed(0)}% (${fmtMoneyCompact(firstMonth.unacceptedQuoteValue)} → ${fmtMoneyCompact(lastMonth.unacceptedQuoteValue)}).`
      : ".");

  const monthRangeLabel = `(${firstMonth.label} → ${lastMonth.label})`;
  const execWindow = exec.available ? `${fmtShortDate(exec.countedFrom!)} – ${fmtShortDate(exec.countedTo!)}` : null;
  const execSuccess = exec.available && exec.completed + exec.failed ? exec.completed / (exec.completed + exec.failed) : null;

  const tokens: Record<string, string> = {
    CUSTOMER_NAME: customerName,
    REPORT_DATE: fmtDateLabel(range.end),
    REPORT_TITLE: reportTitle,

    JOBS_TOTAL: fmtInt(jobs.total),
    JOBS_COMPLETED: fmtInt(jobs.completed),
    JOBS_COMPLETION_RATE: fmtPctFraction(jobs.completionRate),

    QUOTES_TOTAL_VALUE: fmtMoneyCompact(quotes.totalValue),
    QUOTES_TOTAL_LABEL: `Total Quotes – ${fmtInt(quotes.total)}`,
    QUOTES_ACCEPTED_VALUE: fmtMoneyCompact(quotes.accepted.value),
    QUOTES_ACCEPTED_LABEL: `Accepted – ${fmtInt(quotes.accepted.count)}`,
    QUOTES_ACCEPTANCE_RATE: fmtPctFraction(quotes.accepted.rate),

    INVOICES_TOTAL_VALUE: fmtMoneyCompact(invoices.totalValue),
    INVOICES_TOTAL_LABEL: `Total Invoices – ${fmtInt(invoices.billable)}`,
    INVOICES_PAID_VALUE: fmtMoneyCompact(invoices.totalCollected),
    INVOICES_PAID_LABEL: `Paid in full – ${fmtInt(invoices.fullyPaid.count)}`,
    INVOICES_COLLECTION_RATE: fmtPctFraction(invoices.collectionRate),

    PERIOD_LABEL_S20: `${periodLabel} `,
    ACTIVE_USERS: fmtInt(footprint.activeUserCount),

    JOB_CAT1_NAME: cat1?.name ?? "—",
    JOB_CAT1_COUNT: fmtInt(cat1?.count ?? 0),
    JOB_CAT1_PCT: fmtPctFraction(cat1?.pct ?? 0).replace("%", ""),
    JOB_CAT2_NAME: cat2?.name ?? "—",
    JOB_CAT2_COUNT: fmtInt(cat2?.count ?? 0),
    JOB_CAT2_PCT: fmtPctFraction(cat2?.pct ?? 0).replace("%", ""),
    JOB_CAT3_NAME: cat3?.name ?? "—",
    JOB_CAT3_COUNT: fmtInt(cat3?.count ?? 0),
    JOB_CAT3_PCT: fmtPctFraction(cat3?.pct ?? 0).replace("%", ""),
    JOB_PERFORMANCE_INSIGHT: jobPerformanceInsight,

    FOOTPRINT_CURRENT_LABEL: footprint.currentLabel,
    FOOTPRINT_PRIOR_LABEL: footprint.priorLabel,
    FOOTPRINT_QUOTE_VALUE: fmtMoneyCompact(footprint.quoteValue),
    FOOTPRINT_INVOICE_VALUE: fmtMoneyCompact(footprint.invoiceValue),
    FOOTPRINT_PROPERTIES: fmtCountK(footprint.propertiesCount),
    FOOTPRINT_USER_IDENTITIES: fmtInt(footprint.totalUserIdentities),
    FOOTPRINT_PRIOR_JOBS: fmtInt(footprint.priorJobs),
    FOOTPRINT_CURRENT_JOBS: fmtInt(footprint.currentJobs),
    FOOTPRINT_PRIOR_QUOTES: fmtInt(footprint.priorQuotes),
    FOOTPRINT_CURRENT_QUOTES: fmtInt(footprint.currentQuotes),
    FOOTPRINT_PRIOR_INVOICES: fmtInt(footprint.priorInvoices),
    FOOTPRINT_CURRENT_INVOICES: fmtInt(footprint.currentInvoices),

    PERIOD_LABEL_S22: `${periodLabel}  ·  quotes & invoices dated in the period`,
    Q22_QUOTES_TOTAL_VALUE: fmtMoneyCompact(quotes.totalValue),
    Q22_QUOTES_TOTAL_LABEL: `Total Quotes Created  - ${fmtInt(quotes.total)}`,
    Q22_QUOTES_ACCEPTED_LABEL: `${fmtInt(quotes.accepted.count)} Accepted`,
    Q22_QUOTES_ACCEPTED_VALUE: fmtMoneyCompact(quotes.accepted.value),
    Q22_QUOTES_ACCEPTANCE_RATE_LABEL: `${fmtPctFraction(quotes.accepted.rate)} of sent quotes`,
    Q22_QUOTES_DECLINED_LABEL: `${fmtInt(quotes.declined.count)} Declined`,
    Q22_QUOTES_DECLINED_VALUE: fmtMoneyCompact(quotes.declined.value),
    Q22_QUOTES_DECLINE_RATE_LABEL: `${fmtPctFraction(quotes.declined.rate)} of sent quotes`,
    Q22_QUOTES_OPEN_LABEL: `${fmtInt(quotes.open.count)} Open / Pending`,
    Q22_QUOTES_OPEN_VALUE: fmtMoneyCompact(quotes.open.value),
    Q22_QUOTES_OPEN_PCT_LABEL: `${fmtPctFraction(quotes.open.rate)} of all quotes`,
    Q22_QUOTES_ARCHIVED_LABEL: `${fmtInt(quotes.archived.count)} Archived / Canceled`,
    Q22_QUOTES_ARCHIVED_VALUE: fmtMoneyCompact(quotes.archived.value),
    Q22_QUOTES_ARCHIVED_PCT_LABEL: `${fmtPctFraction(quotes.archived.rate)} of all quotes`,

    Q22_INVOICES_TOTAL_LABEL: `Total Invoices  - ${fmtInt(invoices.billable)}`,
    Q22_INVOICES_TOTAL_VALUE: fmtMoneyCompact(invoices.totalValue),
    Q22_INVOICES_FULLYPAID_LABEL: `${fmtInt(invoices.fullyPaid.count)} Fully Paid`,
    Q22_INVOICES_FULLYPAID_VALUE: fmtMoneyCompact(invoices.fullyPaid.value),
    Q22_INVOICES_FULLYPAID_PCT_LABEL: `${fmtPctFraction(invoices.fullyPaid.rate)} of invoices paid in full`,
    Q22_INVOICES_PARTIAL_LABEL: `${fmtInt(invoices.partiallyPaid.count)} Partially Paid`,
    Q22_INVOICES_PARTIAL_COLLECTED_LABEL: `${fmtMoneyCompact(invoices.partiallyPaid.collected)} collected`,
    Q22_INVOICES_PARTIAL_OUTSTANDING_LABEL: `${fmtMoneyCompact(invoices.partiallyPaid.outstanding)} still outstanding`,
    Q22_INVOICES_OPEN_LABEL: `${fmtInt(invoices.open.count)} Open / Unpaid`,
    Q22_INVOICES_OPEN_VALUE: fmtMoneyCompact(invoices.open.value),
    Q22_INVOICES_AGED60_SENTENCE:
      invoices.agedOver60.count > 0
        ? `${fmtMoneyCompact(invoices.agedOver60.value)} outstanding on ${fmtInt(invoices.agedOver60.count)} invoice${invoices.agedOver60.count === 1 ? "" : "s"} more than 60 days past due.`
        : "No invoices from this period are more than 60 days past due.",
    Q22_INVOICES_ARCHIVED_LABEL: `${fmtInt(invoices.archived.count)} Voided / Archived`,
    Q22_INVOICES_ARCHIVED_VALUE: fmtMoneyCompact(invoices.archived.value),
    Q22_INSIGHT_SENTENCE: q22Insight,

    PERIOD_LABEL_S23: `Last 4 quarters (${quarterLabels[0]} – ${quarterLabels[quarterLabels.length - 1]})  ·  totals for ${periodLabel}`,
    S23_INSIGHT: s23Insight,
    S23_RECOMMENDATION: s23Recommendation,
    S23_TOTAL_VALUE: fmtMoneyCompact(quotes.totalValue),
    S23_TOTAL_COUNT: fmtInt(quotes.total),
    S23_ACCEPTED_VALUE: fmtMoneyCompact(quotes.accepted.value),
    S23_ACCEPTED_COUNT: fmtInt(quotes.accepted.count),
    S23_DECLINED_VALUE: fmtMoneyCompact(quotes.declined.value),
    S23_DECLINED_COUNT: fmtInt(quotes.declined.count),
    S23_FULLYEAR_ACCEPTANCE_RATE: fmtPctFraction(quotes.accepted.rate).replace("%", ""),

    PERIOD_LABEL_S24: `Last 4 quarters (${quarterLabels[0]} – ${quarterLabels[quarterLabels.length - 1]})  ·  totals for ${periodLabel}`,
    S24_INSIGHT: s24Insight,
    S24_TOTAL_INVOICE_COUNT: fmtInt(invoices.billable),
    // No "M" suffix here — the template's own run already appends a literal "M" after this token.
    S24_TOTAL_VALUE: (invoices.totalValue / 1_000_000).toFixed(2),
    S24_COLLECTED_VALUE: fmtMoneyCompact(invoices.totalCollected),
    S24_FULLYEAR_COLLECTION_RATE: fmtPctFraction(invoices.collectionRate).replace("%", ""),

    // Plain "&" — replaceTokens() in ebrExport.ts XML-escapes every token value itself.
    PERIOD_LABEL_S25: `Trailing 13 months ${monthRangeLabel}  ·  monthly average invoice value & unaccepted quote value`,
    S25_INSIGHT: s25Insight,
    S25_AVG_INVOICE_DECLINE_PCT: signed(avgInvoicePctChange),
    // Whole-dollar formatting (not millions) — these are per-invoice averages, typically a few thousand dollars.
    S25_AVG_INVOICE_RANGE: firstInv && lastInv ? `$${fmtInt(firstInv.avgInvoiceValue)} → $${fmtInt(lastInv.avgInvoiceValue)}` : "—",
    S25_QUOTE_VALUE_DECLINE_PCT: signed(quoteValuePctChange),
    S25_QUOTE_VALUE_RANGE: `${fmtMoneyCompact(firstMonth.unacceptedQuoteValue)} → ${fmtMoneyCompact(lastMonth.unacceptedQuoteValue)}`,
    S25_AVG_INVOICE_LABEL: firstInv && lastInv ? `Avg Invoice Value (${firstInv.label} → ${lastInv.label})` : "Avg Invoice Value",
    S25_QUOTE_VALUE_LABEL: `Unaccepted Quote Value ${monthRangeLabel}`,

    // "Live" (active + published), not just is_active — an active draft never runs.
    WF_ACTIVE_OF_TOTAL: `${fmtInt(workflowSummary.live)} of ${fmtInt(workflowSummary.total)}`,
    WF_JOBS_CREATED: fmtInt(jobs.total),
    WF_INVOICE_VALUE: fmtMoneyCompact(invoices.totalValue),
    WF_ACTIVE_USERS: fmtInt(footprint.activeUserCount),
  };

  // "Recommended Priorities" slide — deterministic signals (real numbers only), optionally
  // rewritten/personalized by the AI engine using Zuper product knowledge + website context
  // for tone. See ai.generateBusinessRecommendations for the grounding guarantee.
  const signals = computeRecommendationSignals({
    quotesTotal: quotes.sent,
    quotesAcceptanceRate: quotes.accepted.rate,
    quotesOpenValue: quotes.open.value,
    invoicesAgedOver60Count: invoices.agedOver60.count,
    invoicesAgedOver60Value: invoices.agedOver60.value,
    onlinePaymentShare: payments.onlineShare,
    paymentsTotalValue: payments.totalAmount,
    activeWorkflowCount: workflowSummary.live,
    totalWorkflowCount: workflowSummary.total,
    workflowsNeedingAttention: workflowSummary.needsAttention,
    jobsTotal: jobs.total,
    workflowRunsFailed: exec.available ? exec.failed : 0,
    workflowFailureRate: exec.available ? exec.failureRate : 0,
    topWorkflowError: exec.topErrors[0]?.message ?? null,
    onTimeRate: delivery.onTime ? delivery.onTime.onTime / delivery.onTime.eligible : null,
    onTimeEligible: delivery.onTime?.eligible ?? 0,
    overdueOpenJobs: delivery.onTime?.overdueOpen ?? 0,
    completedInvoicedRate: delivery.invoicing && delivery.invoicing.completed ? delivery.invoicing.invoiced / delivery.invoicing.completed : null,
    completedJobs: delivery.invoicing?.completed ?? 0,
    contractsExpiring90d: highlight("service_contracts", "Expiring"),
    missedCalls: highlight("connect_calls", "Missed"),
  });
  const recommendations = await generateBusinessRecommendations(signals, websiteContext, reportTitle);
  recommendations.forEach((rec, i) => {
    tokens[`REC${i + 1}_TITLE`] = rec.title;
    tokens[`REC${i + 1}_DESC`] = rec.description;
  });

  const toM = (n: number) => Math.round(n / 10_000) / 100;
  const acceptedByQuarter = quarters.map((q) => toM(q.quotesAcceptedValue));
  const declinedByQuarter = quarters.map((q) => toM(q.quotesDeclinedValue));
  const invoicedByQuarter = quarters.map((q) => toM(q.invoicesInvoicedValue));
  const collectedByQuarter = quarters.map((q) => toM(q.invoicesCollectedValue));
  const acceptanceRates = quarters.map((q) => Math.round(q.acceptanceRatePct * 10) / 10);
  const collectionRates = quarters.map((q) => Math.round(q.collectionRatePct * 10) / 10);

  const charts: EbrTokenData["charts"] = {
    chart1: {
      categories: quarterLabels,
      seriesValues: [acceptedByQuarter, declinedByQuarter],
      axisMax: niceAxisMax(Math.max(...acceptedByQuarter, ...declinedByQuarter, 0.01)),
    },
    chart2: { categories: quarterLabels, seriesValues: [acceptanceRates], axisMax: niceAxisMax(Math.max(...acceptanceRates, 1)) },
    chart3: {
      categories: quarterLabels,
      seriesValues: [invoicedByQuarter, collectedByQuarter],
      axisMax: niceAxisMax(Math.max(...invoicedByQuarter, ...collectedByQuarter, 0.01)),
    },
    chart4: { categories: quarterLabels, seriesValues: [collectionRates], axisMax: 100 },
    chart5: {
      categories: months.map((m) => m.label),
      seriesValues: [months.map((m) => Math.round(m.avgInvoiceValue))],
      axisMax: niceAxisMax(Math.max(...months.map((m) => m.avgInvoiceValue), 1)),
    },
    chart6: {
      categories: months.map((m) => m.label),
      seriesValues: [months.map((m) => toM(m.unacceptedQuoteValue))],
      axisMax: niceAxisMax(Math.max(...months.map((m) => m.unacceptedQuoteValue / 1_000_000), 0.01)),
    },
  };

  const fixups: Record<string, RunFix[]> = {
    "ppt/slides/slide4.xml": [{ index: 7, expect: "Partnership Journey – (Company Name ) &amp; Zuper", text: `Partnership Journey – ${customerName} & Zuper` }],
    "ppt/slides/slide11.xml": [
      { index: 0, expect: "Partnership Journey — Roof Doctors  Launch", text: `Partnership Journey — ${customerName} Launch` },
      { index: 10, expect: "Roof Doctors validates SOPs built in Zuper", text: `${customerName} validates SOPs built in Zuper` },
      { index: 17, expect: " officially launches for Roof Doctors", text: ` officially launches for ${customerName}` },
    ],
    "ppt/slides/slide15.xml": [
      { index: 5, expect: " full-year 2025", text: ` ${footprint.priorLabel.toLowerCase()}` },
      {
        index: 6,
        expect: "A modern experience is supporting greater operating volume across jobs, estimates and invoices",
        text:
          footprint.priorJobs === 0 && footprint.priorQuotes === 0 && footprint.priorInvoices === 0
            ? `First year on Zuper — every job, estimate and invoice shown is ${footprint.currentLabel}`
            : footprint.currentJobs > footprint.priorJobs && footprint.currentInvoices > footprint.priorInvoices
              ? `Year-to-date jobs and invoices already exceed all of ${footprint.priorLabel.replace(/^Full-year /, "")}`
              : `Year-to-date activity across jobs, estimates and invoices, against last year's full-year total`,
      },
    ],
    "ppt/slides/slide19.xml": [
      { index: 0, expect: "Invoice &amp; Quote Value — A Sharp Decline", text: "Invoice & Quote Value — 13-Month Trend" },
      {
        index: 6,
        expect: " (Accepted quote value remained consistent at $1.2M across quarters)",
        text: ` (Accepted quote value over the same 13 months: ${fmtMoneyCompact(acceptedQuoteValue13m)})`,
      },
      { index: 8, expect: "Avg Invoice Value Decline", text: "Avg Invoice Value Change" },
      { index: 13, expect: "Unaccepted Quote Value Decline", text: "Unaccepted Quote Value Change" },
    ],
    "ppt/slides/slide21.xml": [
      { index: 4, expect: "N/A", text: "Not in API" },
      { index: 6, expect: "N/A", text: "Not in API" },
      { index: 8, expect: "N/A", text: "Not in API" },
      { index: 10, expect: "WORKLFOW PERFORMANCE", text: "WORKFLOW PERFORMANCE" },
      { index: 12, expect: "Active Workflows", text: "Live Workflows" },
      { index: 13, expect: "N/A", text: exec.available ? fmtInt(exec.total) : "Not synced" },
      { index: 14, expect: "Runs – last 3 months", text: execWindow ? `Runs – ${execWindow}` : "Workflow runs" },
      { index: 15, expect: "N/A", text: execSuccess != null ? fmtPctFraction(execSuccess) : "—" },
      { index: 16, expect: "Success rate", text: "Success rate (excl. skipped)" },
    ],
    "ppt/slides/slide27.xml": [
      { index: 2, expect: "Zuper + Roof Doctors", text: `Zuper + ${customerName}` },
      {
        index: 4,
        expect: "Select the two outcomes Roof Doctors and Zuper should prioritize during the next six months",
        text: `Select the two outcomes ${customerName} and Zuper should prioritize during the next six months`,
      },
    ],
    "ppt/slides/slide29.xml": [
      {
        index: 5,
        expect: "Zuper’s Roofing and Exteriors focus matches Roof Doctors aspirations",
        text: `Zuper’s services focus matches ${customerName}'s growth plans`,
      },
    ],
  };

  const notes = buildTemplateNotes({
    customerName,
    range,
    periodLabel,
    jobs,
    quotes,
    invoices,
    payments,
    topCategories,
    footprint,
    quarters,
    months,
    workflowSummary,
    exec,
    sync,
    firsts,
    signals,
    recommendations,
    acceptedQuoteValue13m,
    avgInvoicePctChange,
    quoteValuePctChange,
  });

  return { tokens, charts, usage, workflowSummary, periodLabel, fixups, notes };
}
