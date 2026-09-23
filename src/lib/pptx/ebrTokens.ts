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
import {
  computeExecutionDeepDive,
  computeSyncInfo,
  computeAccountActivityDates,
  computeJobDeepDive,
  computeQuoteDeepDive,
  type ExecutionDeepDive,
  type JobDeepDive,
  type QuoteDeepDive,
  type SyncInfo,
} from "@/lib/reports/moduleMetrics";
import { computeCatalogAnalyses, computeJobServiceDelivery, type JobServiceDelivery, type ModuleAnalysis } from "@/lib/reports/catalogMetrics";
import { momentum, rank, type Callout } from "@/lib/reports/callouts";
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
  /** Template slide path -> ranked call-outs (shown on-slide where there's room, and on the Top Call-outs slide). */
  callouts: Record<string, Callout[]>;
}

/** Computed once per export and shared by the template tokens and the generated slides. */
export interface SharedDeckData {
  catalog: ModuleAnalysis[];
  delivery: JobServiceDelivery;
  jobsDeep: JobDeepDive;
  quotesDeep: QuoteDeepDive;
  exec: ExecutionDeepDive;
  sync: SyncInfo;
}

export async function computeSharedDeckData(customerId: string, range: DateRange): Promise<SharedDeckData> {
  const [catalog, delivery, jobsDeep, quotesDeep, exec, sync] = await Promise.all([
    computeCatalogAnalyses(customerId, range),
    computeJobServiceDelivery(customerId, range),
    computeJobDeepDive(customerId, range),
    computeQuoteDeepDive(customerId, range),
    computeExecutionDeepDive(customerId, range),
    computeSyncInfo(customerId, range),
  ]);
  return { catalog, delivery, jobsDeep, quotesDeep, exec, sync };
}

export async function buildEbrTokenData(
  customerId: string,
  customerName: string,
  customerWebsite: string | null,
  range: DateRange,
  reportTitle: string,
  shared: SharedDeckData
): Promise<EbrTokenData> {
  const { catalog, delivery, jobsDeep, quotesDeep, exec, sync } = shared;
  const [jobs, quotes, invoices, payments, topCategories, footprint, quarters, months, workflowSummary, websiteContext, usage, firsts] =
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
      computeAccountActivityDates(customerId),
    ]);
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
  // Kept to one short line: the template's insight row sits right under the cards.
  const q22Insight = invoices.billable
    ? `${fmtPctFraction(invoices.collectionRate)} of ${fmtMoneyCompact(invoices.totalValue)} invoiced is collected` +
      (quotes.open.value > 0 ? `; ${fmtMoneyCompact(quotes.open.value)} in quotes awaits a response.` : ".")
    : quotes.open.value > 0
      ? `No invoices this period; ${fmtMoneyCompact(quotes.open.value)} in quotes awaits a response.`
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
      (quartersWithInvoices.length > 1
        ? `Invoiced value moved from ${fmtMoneyCompact(quartersWithInvoices[0].invoicesInvoicedValue)} (${quartersWithInvoices[0].label}) to ${fmtMoneyCompact(lastQuarter.invoicesInvoicedValue)} (${lastQuarter.label}).`
        : "") +
      (lastQuarter.label === quarterLabels[quarterLabels.length - 1] && range.end < new Date(Date.UTC(range.end.getUTCFullYear(), Math.floor(range.end.getUTCMonth() / 3) * 3 + 3, 1))
        ? ` ${lastQuarter.label} is still in progress, so its collection rate will rise as invoices are paid.`
        : "");
  } else {
    s24Insight = "No invoices were issued in the last four quarters.";
  }

  // 13-month trend: the last 3 months vs the 3 before, so one thin month (e.g. the account's first)
  // can't swing the comparison. Average invoice value only counts months with ≥5 invoices.
  const MIN_INVOICES = 5;
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  const short = (label: string) => label.replace(/-20(\d\d)$/, " $1");
  const windowAvg = (ms: typeof months) => {
    const ok = ms.filter((m) => m.invoiceCount >= MIN_INVOICES);
    const n = ok.reduce((s, m) => s + m.invoiceCount, 0);
    return ok.length ? ok.reduce((s, m) => s + m.avgInvoiceValue * m.invoiceCount, 0) / n : null;
  };
  const recent3 = months.slice(-3);
  const prior3 = months.slice(-6, -3);
  const recentAvg = windowAvg(recent3);
  const priorAvg = windowAvg(prior3);
  const avgInvoicePctChange = recentAvg != null && priorAvg ? ((recentAvg - priorAvg) / priorAvg) * 100 : null;
  const quoteTrend = momentum(months.map((m) => ({ label: short(m.label), value: m.unacceptedQuoteValue })), 3, 1);
  const quoteValuePctChange = quoteTrend?.change != null && quoteTrend.prior > 0 ? quoteTrend.change * 100 : null;
  const acceptedQuoteValue13m = months.reduce((s, m) => s + m.acceptedQuoteValue, 0);
  const windowLabel = (ms: typeof months) => `${short(ms[0].label)}–${short(ms[ms.length - 1].label)}`;
  const signed = (pct: number | null) => (pct == null ? "n/a" : `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`);

  const s25Insight =
    (avgInvoicePctChange != null
      ? `Average invoice value was $${fmtInt(recentAvg!)} in ${windowLabel(recent3)} vs $${fmtInt(priorAvg!)} in ${windowLabel(prior3)} (${signed(avgInvoicePctChange)})`
      : recentAvg != null
        ? `Average invoice value was $${fmtInt(recentAvg)} over ${windowLabel(recent3)}`
        : "Too few invoices per month for a stable average-invoice trend") +
    // Recent quotes are still being decided, so their "unaccepted" value isn't comparable with older,
    // decided quotes (SPEC §14.4: don't compare immature cohorts) — state the value, not a % change.
    (quoteTrend ? `; ${fmtMoneyCompact(quoteTrend.recent)} of quotes from ${windowLabel(recent3)} is not yet accepted — most are still awaiting a decision.` : ".");

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

    // The template's next run is the literal word "Zuper", so this must read into it.
    PERIOD_LABEL_S22: `${periodLabel}  ·  quotes & invoices recorded in `,
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
    S25_AVG_INVOICE_RANGE: recentAvg != null && priorAvg != null ? `$${fmtInt(priorAvg)} → $${fmtInt(recentAvg)}` : recentAvg != null ? `$${fmtInt(recentAvg)}` : "—",
    S25_QUOTE_VALUE_DECLINE_PCT: quoteTrend ? fmtMoneyCompact(quoteTrend.recent) : "—",
    S25_QUOTE_VALUE_RANGE: quoteTrend ? `${fmtMoneyCompact(quoteTrend.prior)} in the 3 months before` : "—",
    S25_AVG_INVOICE_LABEL: `Avg invoice, ${windowLabel(prior3)} → ${windowLabel(recent3)}`,
    S25_QUOTE_VALUE_LABEL: "Recent quotes are still being decided",

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

  // null = no activity in that quarter/month: drawn as a gap with no label, not as a misleading 0.
  const toM = (n: number) => Math.round(n / 10_000) / 100;
  const hasQuotes = (q: (typeof quarters)[number]) => q.quotesSent > 0;
  const hasInvoices = (q: (typeof quarters)[number]) => q.invoicesInvoicedValue > 0;
  const acceptedByQuarter = quarters.map((q) => (hasQuotes(q) ? toM(q.quotesAcceptedValue) : null));
  const declinedByQuarter = quarters.map((q) => (hasQuotes(q) ? toM(q.quotesDeclinedValue) : null));
  const invoicedByQuarter = quarters.map((q) => (hasInvoices(q) ? toM(q.invoicesInvoicedValue) : null));
  const collectedByQuarter = quarters.map((q) => (hasInvoices(q) ? toM(q.invoicesCollectedValue) : null));
  const acceptanceRates = quarters.map((q) => (hasQuotes(q) ? Math.round(q.acceptanceRatePct * 10) / 10 : null));
  const collectionRates = quarters.map((q) => (hasInvoices(q) ? Math.round(q.collectionRatePct * 10) / 10 : null));
  const maxOf = (...xs: (number | null)[]) => Math.max(0, ...xs.filter((x): x is number => x != null));
  const monthLabels = months.map((m) => short(m.label));

  const charts: EbrTokenData["charts"] = {
    chart1: {
      categories: quarterLabels,
      seriesValues: [acceptedByQuarter, declinedByQuarter],
      axisMax: niceAxisMax(Math.max(maxOf(...acceptedByQuarter, ...declinedByQuarter), 0.01)),
    },
    chart2: { categories: quarterLabels, seriesValues: [acceptanceRates], axisMax: niceAxisMax(Math.max(maxOf(...acceptanceRates), 1)) },
    chart3: {
      categories: quarterLabels,
      seriesValues: [invoicedByQuarter, collectedByQuarter],
      axisMax: niceAxisMax(Math.max(maxOf(...invoicedByQuarter, ...collectedByQuarter), 0.01)),
    },
    chart4: { categories: quarterLabels, seriesValues: [collectionRates], axisMax: 100 },
    chart5: {
      categories: monthLabels,
      seriesValues: [months.map((m) => (m.invoiceCount > 0 ? Math.round(m.avgInvoiceValue) : null))],
      axisMax: niceAxisMax(Math.max(...months.map((m) => m.avgInvoiceValue), 1)),
    },
    chart6: {
      categories: monthLabels,
      seriesValues: [months.map((m) => (m.quoteCount > 0 ? toM(m.unacceptedQuoteValue) : null))],
      axisMax: niceAxisMax(Math.max(...months.map((m) => m.unacceptedQuoteValue / 1_000_000), 0.01)),
    },
  };

  // ---- Call-outs for the template's KPI slides --------------------------------------------------
  const money = fmtMoneyCompact;
  const pct0 = (n: number) => `${(n * 100).toFixed(0)}%`;
  const cats = jobsDeep.categories.filter((c) => !c.name.startsWith("Other"));
  const bigCat = cats[0];
  const jobTrend = momentum(jobsDeep.monthly.map((m) => ({ label: m.label, value: m.created })), 3, 30);
  const businessCallouts = rank([
    jobTrend?.change != null &&
      Math.abs(jobTrend.change) >= 0.15 && {
        tone: jobTrend.change > 0 ? "win" : "risk",
        headline: `Job volume ${jobTrend.change > 0 ? "up" : "down"} ${pct0(Math.abs(jobTrend.change))} in ${jobTrend.recentLabel}`,
        detail: `${fmtInt(jobTrend.recent)} jobs created vs ${fmtInt(jobTrend.prior)} in ${jobTrend.priorLabel}${jobTrend.change > 0 ? " — more work flowing through Zuper" : " — worth asking what changed"}.`,
        score: 55 + Math.min(20, Math.abs(jobTrend.change) * 40),
        area: "Jobs",
      },
    bigCat &&
      cats.length > 1 &&
      jobs.total > 0 && {
        tone: "watch",
        headline: `${pct0(jobs.completionRate)} of jobs completed — ${bigCat.name} is ${pct0(bigCat.created / jobs.total)} of volume`,
        detail: cats
          .slice(0, 3)
          .map((c) => `${c.name} ${pct0(c.created ? c.completed / c.created : 0)} complete`)
          .join(", ") + " — read completion by category, not overall.",
        score: 50,
        area: "Jobs",
      },
    quotes.sent >= 10 && {
      tone: quotes.accepted.rate < 0.3 ? "risk" : quotes.accepted.rate >= 0.5 ? "win" : "watch",
      headline: `${pct0(quotes.accepted.rate)} of ${fmtInt(quotes.sent)} sent quotes accepted (${money(quotes.accepted.value)})`,
      detail:
        quotesDeep.expiredOpen > 0
          ? `${fmtInt(quotesDeep.expiredOpen)} quotes expired without a decision and ${money(quotes.open.value)} still awaits a response — follow-up is the lever.`
          : `${money(quotes.open.value)} still awaits a response.`,
      score: quotes.accepted.rate < 0.3 ? 72 : quotes.accepted.rate >= 0.5 ? 60 : 45,
      area: "Quotes",
    },
    invoices.billable > 0 && {
      tone: invoices.collectionRate >= 0.9 ? "win" : invoices.collectionRate < 0.8 ? "risk" : "watch",
      headline: `${pct0(invoices.collectionRate)} of ${money(invoices.totalValue)} invoiced is collected`,
      detail:
        invoices.agedOver60.count > 0
          ? `${money(invoices.agedOver60.value)} on ${fmtInt(invoices.agedOver60.count)} invoices is 60+ days past due — the collections priority.`
          : "Nothing from this period is 60+ days past due.",
      score: invoices.agedOver60.value > 50_000 ? 68 : invoices.collectionRate >= 0.9 ? 55 : 50,
      area: "Collections",
    },
  ] as (Callout | false | null | undefined)[]);

  const worstFlow = [...exec.perWorkflow].sort((a, b) => b.failed - a.failed)[0];
  const platformCallouts = rank([
    exec.available &&
      exec.failed >= 20 &&
      worstFlow && {
        tone: "risk",
        headline: `${fmtInt(exec.failed)} workflow runs failed (${pct0(exec.failureRate)} of runs that executed)`,
        detail: `"${worstFlow.name}" alone accounts for ${pct0(worstFlow.failed / exec.failed)} of failures${exec.topErrors[0] ? ` ("${exec.topErrors[0].message}")` : ""} — fixing one workflow removes most of the noise.`,
        score: 70 + Math.min(20, (worstFlow.failed / exec.failed) * 20),
        area: "Automation",
      },
    workflowSummary.live > 0 && {
      tone: "win",
      headline: `${fmtInt(workflowSummary.live)} live workflows automate ${fmtInt(workflowSummary.liveSteps)} steps`,
      detail: `${fmtInt(workflowSummary.webhookTriggered)} are triggered by other systems — Zuper is wired into ${customerName}'s wider stack.`,
      score: 40,
      area: "Automation",
    },
  ] as (Callout | false | null | undefined)[]);

  const callouts: Record<string, Callout[]> = {
    "ppt/slides/slide13.xml": businessCallouts,
    "ppt/slides/slide21.xml": platformCallouts,
  };
  // The template's own one-line insight rows get the top call-out where it fits.
  if (businessCallouts[0]) tokens.JOB_PERFORMANCE_INSIGHT = cats.length > 1 ? businessCallouts.find((c) => c.area === "Jobs")?.detail ?? jobPerformanceInsight : jobPerformanceInsight;

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
      { index: 6, expect: " (Accepted quote value remained consistent at $1.2M across quarters)", text: ` · ${fmtMoneyCompact(acceptedQuoteValue13m)} accepted` },
      { index: 8, expect: "Avg Invoice Value Decline", text: "Avg Invoice Value, last 3 months" },
      { index: 13, expect: "Unaccepted Quote Value Decline", text: "Not yet accepted, last 3 months" },
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

  return { tokens, charts, usage, workflowSummary, periodLabel, fixups, notes, callouts };
}
