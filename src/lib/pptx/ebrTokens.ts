import type { DateRange } from "@/lib/zuper/modules";
import { computeJobMetrics, computePaymentMetrics } from "@/lib/analytics";
import {
  computeQuoteBreakdown,
  computeInvoiceBreakdown,
  computeTopJobCategories,
  computeFootprintComparison,
  computeQuarterlySeries,
  computeMonthlySeries,
  computeWorkflowSummary,
  computeRecommendationSignals,
} from "@/lib/reports/ebrMetrics";
import { generateBusinessRecommendations } from "@/lib/ai";
import { fetchWebsiteContext } from "@/lib/website";
import { niceAxisMax, type LineChartData } from "./chartData";

// ---------------------------------------------------------------------------
// Builds the {{TOKEN}} -> display-string map and chart datasets consumed by
// lib/pptx/ebrExport.ts. Token names here MUST match the ones baked into
// templates/ebr-template.pptx by scripts/tokenize-qbr-template.mjs — the two
// are kept in sync by hand (see that script's comment header) since one is a
// one-time preprocessing script and the other runs per export.
// ---------------------------------------------------------------------------

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** n is a raw dollar amount (not millions). */
function fmtMoneyM(n: number, space = false): string {
  const val = (n / 1_000_000).toFixed(2);
  return space ? `$ ${val}M` : `$${val}M`;
}

/** n is a 0-1 fraction. */
function fmtPctFraction(n: number, decimals = 2): string {
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

function fmtPeriodLabel(range: DateRange): string {
  return `${fmtDateLabel(range.start)} – ${fmtDateLabel(range.end)}`;
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
}

export async function buildEbrTokenData(
  customerId: string,
  customerName: string,
  customerWebsite: string | null,
  range: DateRange,
  reportTitle: string
): Promise<EbrTokenData> {
  const [jobs, quotes, invoices, payments, topCategories, footprint, quarters, months, workflowSummary, websiteContext] =
    await Promise.all([
      computeJobMetrics(customerId, range),
      computeQuoteBreakdown(customerId, range),
      computeInvoiceBreakdown(customerId, range),
      computePaymentMetrics(customerId, range),
      computeTopJobCategories(customerId, range, 3),
      computeFootprintComparison(customerId, range),
      computeQuarterlySeries(customerId, range, 4),
      computeMonthlySeries(customerId, range, 13),
      computeWorkflowSummary(customerId),
      customerWebsite ? fetchWebsiteContext(customerWebsite) : Promise.resolve(null),
    ]);

  const [cat1, cat2, cat3] = topCategories;
  const periodLabel = fmtPeriodLabel(range);

  const jobPerformanceInsightParts = [
    cat1 ? `led by ${cat1.name} at ${fmtPctFraction(cat1.pct, 1)}` : null,
    cat2 ? `followed by ${cat2.name} at ${fmtPctFraction(cat2.pct, 1)}` : null,
    cat3 ? `and ${cat3.name} at ${fmtPctFraction(cat3.pct, 1)}` : null,
  ].filter(Boolean);
  const jobPerformanceInsight = `${fmtInt(jobs.completed)} jobs completed, ${jobPerformanceInsightParts.join(", ")}`;

  const q22Insight =
    `Collections stand at ${fmtPctFraction(invoices.collectionRate, 1)} across ${fmtMoneyM(invoices.totalValue)} invoiced this period` +
    (quotes.open.value > 0
      ? `, with ${fmtMoneyM(quotes.open.value)} in quotes still open — the largest lever for incremental revenue.`
      : ".");

  const quarterLabels = quarters.map((q) => q.label);
  const acceptanceRates = quarters.map((q) => q.acceptanceRatePct);
  const collectionRates = quarters.map((q) => q.collectionRatePct);
  const minAcceptanceIdx = acceptanceRates.indexOf(Math.min(...acceptanceRates));
  const maxAcceptanceIdx = acceptanceRates.indexOf(Math.max(...acceptanceRates));
  const minCollectionIdx = collectionRates.indexOf(Math.min(...collectionRates));
  const maxCollectionIdx = collectionRates.indexOf(Math.max(...collectionRates));
  const lastQuarter = quarters[quarters.length - 1];

  const s23Insight =
    `Quote acceptance ranged from ${fmtPctScaled(acceptanceRates[minAcceptanceIdx])} in ${quarterLabels[minAcceptanceIdx]} ` +
    `to ${fmtPctScaled(acceptanceRates[maxAcceptanceIdx])} in ${quarterLabels[maxAcceptanceIdx]}, ending the period at ` +
    `${fmtPctScaled(lastQuarter.acceptanceRatePct)} in ${quarterLabels[quarterLabels.length - 1]}. ` +
    `${fmtInt(quotes.open.count)} quotes remain open, representing ${fmtMoneyM(quotes.open.value)} in pipeline value.`;

  const s23Recommendation =
    "Prioritize follow-up on aging quotes, turn on automated quote reminders, and use text reminders to lift acceptance on the open " +
    `${fmtMoneyM(quotes.open.value)} pipeline.`;

  const s24Insight =
    `Collection rate ranged from ${fmtPctScaled(collectionRates[minCollectionIdx])} in ${quarterLabels[minCollectionIdx]} ` +
    `to ${fmtPctScaled(collectionRates[maxCollectionIdx])} in ${quarterLabels[maxCollectionIdx]}. Invoiced value moved from ` +
    `${fmtMoneyM(quarters[0].invoicesInvoicedValue)} (${quarterLabels[0]}) to ` +
    `${fmtMoneyM(lastQuarter.invoicesInvoicedValue)} (${quarterLabels[quarterLabels.length - 1]}).`;

  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  const avgInvoicePctChange = firstMonth.avgInvoiceValue
    ? ((lastMonth.avgInvoiceValue - firstMonth.avgInvoiceValue) / firstMonth.avgInvoiceValue) * 100
    : 0;
  const quoteValuePctChange = firstMonth.unacceptedQuoteValue
    ? ((lastMonth.unacceptedQuoteValue - firstMonth.unacceptedQuoteValue) / firstMonth.unacceptedQuoteValue) * 100
    : 0;

  const s25Insight =
    `Average invoice value ${avgInvoicePctChange >= 0 ? "rose" : "fell"} ${Math.abs(avgInvoicePctChange).toFixed(0)}% ` +
    `(${fmtMoneyM(firstMonth.avgInvoiceValue)} → ${fmtMoneyM(lastMonth.avgInvoiceValue)}) while unaccepted quote value ` +
    `${quoteValuePctChange >= 0 ? "rose" : "fell"} ${Math.abs(quoteValuePctChange).toFixed(0)}% ` +
    `(${fmtMoneyM(firstMonth.unacceptedQuoteValue)} → ${fmtMoneyM(lastMonth.unacceptedQuoteValue)}) over the trailing 13 months.`;

  const monthRangeLabel = `(${firstMonth.label} → ${lastMonth.label})`;

  const tokens: Record<string, string> = {
    CUSTOMER_NAME: customerName,
    REPORT_DATE: fmtDateLabel(range.end),
    REPORT_TITLE: reportTitle,

    JOBS_TOTAL: fmtInt(jobs.total),
    JOBS_COMPLETED: fmtInt(jobs.completed),
    JOBS_COMPLETION_RATE: fmtPctFraction(jobs.completionRate),

    QUOTES_TOTAL_VALUE: fmtMoneyM(quotes.totalValue),
    QUOTES_TOTAL_LABEL: `Total Quotes – ${fmtInt(quotes.total)}`,
    QUOTES_ACCEPTED_VALUE: fmtMoneyM(quotes.accepted.value),
    QUOTES_ACCEPTED_LABEL: `Accepted – ${fmtInt(quotes.accepted.count)}`,
    QUOTES_ACCEPTANCE_RATE: fmtPctFraction(quotes.accepted.rate),

    INVOICES_TOTAL_VALUE: fmtMoneyM(invoices.totalValue),
    INVOICES_TOTAL_LABEL: `Total Invoices – ${fmtInt(invoices.total)}`,
    INVOICES_PAID_VALUE: fmtMoneyM(invoices.totalCollected),
    INVOICES_PAID_LABEL: `Paid – ${fmtInt(invoices.fullyPaid.count)}`,
    INVOICES_COLLECTION_RATE: fmtPctFraction(invoices.collectionRate),

    PERIOD_LABEL_S20: `${periodLabel} `,
    ACTIVE_USERS: fmtInt(footprint.activeUserCount),

    JOB_CAT1_NAME: cat1?.name ?? "Unspecified",
    JOB_CAT1_COUNT: fmtInt(cat1?.count ?? 0),
    JOB_CAT1_PCT: fmtPctFraction(cat1?.pct ?? 0, 1).replace("%", ""),
    JOB_CAT2_NAME: cat2?.name ?? "Unspecified",
    JOB_CAT2_COUNT: fmtInt(cat2?.count ?? 0),
    JOB_CAT2_PCT: fmtPctFraction(cat2?.pct ?? 0, 1).replace("%", ""),
    JOB_CAT3_NAME: cat3?.name ?? "Unspecified",
    JOB_CAT3_COUNT: fmtInt(cat3?.count ?? 0),
    JOB_CAT3_PCT: fmtPctFraction(cat3?.pct ?? 0, 1).replace("%", ""),
    JOB_PERFORMANCE_INSIGHT: jobPerformanceInsight,

    FOOTPRINT_CURRENT_LABEL: footprint.currentLabel,
    FOOTPRINT_PRIOR_LABEL: footprint.priorLabel,
    FOOTPRINT_QUOTE_VALUE: fmtMoneyM(footprint.quoteValue),
    FOOTPRINT_INVOICE_VALUE: fmtMoneyM(footprint.invoiceValue),
    FOOTPRINT_PROPERTIES: fmtCountK(footprint.propertiesCount),
    FOOTPRINT_USER_IDENTITIES: fmtInt(footprint.totalUserIdentities),
    FOOTPRINT_PRIOR_JOBS: fmtInt(footprint.priorJobs),
    FOOTPRINT_CURRENT_JOBS: fmtInt(footprint.currentJobs),
    FOOTPRINT_PRIOR_QUOTES: fmtInt(footprint.priorQuotes),
    FOOTPRINT_CURRENT_QUOTES: fmtInt(footprint.currentQuotes),
    FOOTPRINT_PRIOR_INVOICES: fmtInt(footprint.priorInvoices),
    FOOTPRINT_CURRENT_INVOICES: fmtInt(footprint.currentInvoices),

    PERIOD_LABEL_S22: `${periodLabel}  ·  Full year actuals from `,
    Q22_QUOTES_TOTAL_VALUE: fmtMoneyM(quotes.totalValue, true),
    Q22_QUOTES_TOTAL_LABEL: `Total Quotes Created  - ${fmtInt(quotes.total)}`,
    Q22_QUOTES_ACCEPTED_LABEL: `${fmtInt(quotes.accepted.count)} Accepted`,
    Q22_QUOTES_ACCEPTED_VALUE: fmtMoneyM(quotes.accepted.value),
    Q22_QUOTES_ACCEPTANCE_RATE_LABEL: `${fmtPctFraction(quotes.accepted.rate, 1)} acceptance rate`,
    Q22_QUOTES_DECLINED_LABEL: `${fmtInt(quotes.declined.count)} Declined`,
    Q22_QUOTES_DECLINED_VALUE: fmtMoneyM(quotes.declined.value),
    Q22_QUOTES_DECLINE_RATE_LABEL: `${fmtPctFraction(quotes.declined.rate, 1)} decline rate`,
    Q22_QUOTES_OPEN_LABEL: `${fmtInt(quotes.open.count)} Open / Pending`,
    Q22_QUOTES_OPEN_VALUE: fmtMoneyM(quotes.open.value),
    Q22_QUOTES_OPEN_PCT_LABEL: `${fmtPctFraction(quotes.open.rate, 1)} still in pipeline`,
    Q22_QUOTES_ARCHIVED_LABEL: `${fmtInt(quotes.archived.count)} Archived / Canceled`,
    Q22_QUOTES_ARCHIVED_VALUE: fmtMoneyM(quotes.archived.value),
    Q22_QUOTES_ARCHIVED_PCT_LABEL: `${fmtPctFraction(quotes.archived.rate, 1)} voided`,

    Q22_INVOICES_TOTAL_LABEL: `Total Invoices  - ${fmtInt(invoices.total)}`,
    Q22_INVOICES_TOTAL_VALUE: fmtMoneyM(invoices.totalValue, true),
    Q22_INVOICES_FULLYPAID_LABEL: `${fmtInt(invoices.fullyPaid.count)} Fully Paid`,
    Q22_INVOICES_FULLYPAID_VALUE: fmtMoneyM(invoices.fullyPaid.value),
    Q22_INVOICES_FULLYPAID_PCT_LABEL: `${fmtPctFraction(invoices.fullyPaid.rate, 1)} of invoices paid in full`,
    Q22_INVOICES_PARTIAL_LABEL: `${fmtInt(invoices.partiallyPaid.count)} Partially Paid`,
    Q22_INVOICES_PARTIAL_COLLECTED_LABEL: `${fmtMoneyM(invoices.partiallyPaid.collected)} collected`,
    Q22_INVOICES_PARTIAL_OUTSTANDING_LABEL: `${fmtMoneyM(invoices.partiallyPaid.outstanding)} still outstanding`,
    Q22_INVOICES_OPEN_LABEL: `${fmtInt(invoices.open.count)} Open / Unpaid`,
    Q22_INVOICES_OPEN_VALUE: fmtMoneyM(invoices.open.value),
    Q22_INVOICES_AGED60_SENTENCE:
      invoices.open.agedOver60Count > 0
        ? `${fmtMoneyM(invoices.open.agedOver60Value)}+ in open/unpaid invoices aged over 60 days (${fmtInt(invoices.open.agedOver60Count)} invoices).`
        : "No open invoices are currently aged over 60 days.",
    Q22_INVOICES_ARCHIVED_LABEL: `${fmtInt(invoices.archived.count)} Archived / Canceled`,
    Q22_INVOICES_ARCHIVED_VALUE: fmtMoneyM(invoices.archived.value),
    Q22_INSIGHT_SENTENCE: q22Insight,

    PERIOD_LABEL_S23: `${periodLabel}  ·  Total quotes: ${fmtInt(quotes.total)}  ·  ${fmtMoneyM(quotes.open.value)} pipeline value`,
    S23_INSIGHT: s23Insight,
    S23_RECOMMENDATION: s23Recommendation,
    S23_TOTAL_VALUE: fmtMoneyM(quotes.totalValue),
    S23_TOTAL_COUNT: fmtInt(quotes.total),
    S23_ACCEPTED_VALUE: fmtMoneyM(quotes.accepted.value),
    S23_ACCEPTED_COUNT: fmtInt(quotes.accepted.count),
    S23_DECLINED_VALUE: fmtMoneyM(quotes.declined.value),
    S23_DECLINED_COUNT: fmtInt(quotes.declined.count),
    S23_FULLYEAR_ACCEPTANCE_RATE: fmtPctFraction(quotes.accepted.rate, 1).replace("%", ""),

    PERIOD_LABEL_S24: `${periodLabel}  ·  Total invoices: ${fmtInt(invoices.total)}  ·  ${fmtMoneyM(invoices.totalValue)} invoiced  ·  ${fmtMoneyM(invoices.totalCollected)} collected`,
    S24_INSIGHT: s24Insight,
    S24_TOTAL_INVOICE_COUNT: fmtInt(invoices.total),
    // No "M" suffix here — the template's own run already appends a literal "M" after this token.
    S24_TOTAL_VALUE: (invoices.totalValue / 1_000_000).toFixed(2),
    S24_COLLECTED_VALUE: fmtMoneyM(invoices.totalCollected),
    S24_FULLYEAR_COLLECTION_RATE: fmtPctFraction(invoices.collectionRate, 1).replace("%", ""),

    // Plain "&" — replaceTokens() in ebrExport.ts XML-escapes every token value itself.
    PERIOD_LABEL_S25: `${periodLabel}  ·  Monthly average invoice value & unaccepted quote value`,
    S25_INSIGHT: s25Insight,
    S25_AVG_INVOICE_DECLINE_PCT: `${avgInvoicePctChange >= 0 ? "+" : "-"}${Math.abs(avgInvoicePctChange).toFixed(0)}%`,
    // Whole-dollar formatting (not millions) — these are per-invoice averages, typically a few thousand dollars.
    S25_AVG_INVOICE_RANGE: `$${fmtInt(firstMonth.avgInvoiceValue)} → $${fmtInt(lastMonth.avgInvoiceValue)}`,
    S25_QUOTE_VALUE_DECLINE_PCT: `${quoteValuePctChange >= 0 ? "+" : "-"}${Math.abs(quoteValuePctChange).toFixed(0)}%`,
    S25_QUOTE_VALUE_RANGE: `${fmtMoneyM(firstMonth.unacceptedQuoteValue)} → ${fmtMoneyM(lastMonth.unacceptedQuoteValue)}`,
    S25_AVG_INVOICE_LABEL: `Avg Invoice Value ${monthRangeLabel}`,
    S25_QUOTE_VALUE_LABEL: `Unaccepted Quote Value ${monthRangeLabel}`,

    // Platform Performance slide — only fields the API actually exposes are populated
    // (see ebrMetrics.computeWorkflowSummary comment); API calls/latency/attachments/
    // runs/success-rate/contracted-users are filled with a literal "N/A" in the template.
    WF_ACTIVE_OF_TOTAL: `${fmtInt(workflowSummary.active)} of ${fmtInt(workflowSummary.total)}`,
    WF_JOBS_CREATED: fmtInt(jobs.total),
    WF_INVOICE_VALUE: fmtMoneyM(invoices.totalValue),
    WF_ACTIVE_USERS: fmtInt(footprint.activeUserCount),
  };

  // "Recommended Priorities" slide — deterministic signals (real numbers only), optionally
  // rewritten/personalized by the AI engine using Zuper product knowledge + website context
  // for tone. See ai.generateBusinessRecommendations for the grounding guarantee.
  const signals = computeRecommendationSignals({
    quotesTotal: quotes.total,
    quotesAcceptanceRate: quotes.accepted.rate,
    quotesOpenValue: quotes.open.value,
    invoicesAgedOver60Count: invoices.open.agedOver60Count,
    invoicesAgedOver60Value: invoices.open.agedOver60Value,
    onlinePaymentShare: payments.onlineShare,
    paymentsTotalValue: payments.totalAmount,
    activeWorkflowCount: workflowSummary.active,
    totalWorkflowCount: workflowSummary.total,
    jobsTotal: jobs.total,
  });
  const recommendations = await generateBusinessRecommendations(signals, websiteContext, reportTitle);
  recommendations.forEach((rec, i) => {
    tokens[`REC${i + 1}_TITLE`] = rec.title;
    tokens[`REC${i + 1}_DESC`] = rec.description;
  });

  const acceptedByQuarter = quarters.map((q) => Math.round(q.quotesAcceptedValue / 10_000) / 100);
  const declinedByQuarter = quarters.map((q) => Math.round(q.quotesDeclinedValue / 10_000) / 100);
  const invoicedByQuarter = quarters.map((q) => Math.round(q.invoicesInvoicedValue / 10_000) / 100);
  const collectedByQuarter = quarters.map((q) => Math.round(q.invoicesCollectedValue / 10_000) / 100);

  const charts: EbrTokenData["charts"] = {
    chart1: {
      categories: quarterLabels,
      seriesValues: [acceptedByQuarter, declinedByQuarter],
      axisMax: niceAxisMax(Math.max(...acceptedByQuarter, ...declinedByQuarter, 0.01)),
    },
    chart2: {
      categories: quarterLabels,
      seriesValues: [acceptanceRates],
      axisMax: niceAxisMax(Math.max(...acceptanceRates, 1)),
    },
    chart3: {
      categories: quarterLabels,
      seriesValues: [invoicedByQuarter, collectedByQuarter],
      axisMax: niceAxisMax(Math.max(...invoicedByQuarter, ...collectedByQuarter, 0.01)),
    },
    chart4: {
      categories: quarterLabels,
      seriesValues: [collectionRates],
      axisMax: 100,
    },
    chart5: {
      categories: months.map((m) => m.label),
      seriesValues: [months.map((m) => Math.round(m.avgInvoiceValue))],
      axisMax: niceAxisMax(Math.max(...months.map((m) => m.avgInvoiceValue), 1)),
    },
    chart6: {
      categories: months.map((m) => m.label),
      seriesValues: [months.map((m) => Math.round((m.unacceptedQuoteValue / 10_000)) / 100)],
      axisMax: niceAxisMax(Math.max(...months.map((m) => m.unacceptedQuoteValue / 1_000_000), 0.01)),
    },
  };

  return { tokens, charts };
}
