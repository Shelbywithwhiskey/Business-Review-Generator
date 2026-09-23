import { prisma } from "@/lib/db";
import type { DateRange } from "@/lib/zuper/modules";

// ---------------------------------------------------------------------------
// Metrics specific to the EBR/QBR PPTX template (see lib/pptx/*). Deterministic,
// no AI — same rule as lib/analytics.ts. Quote/invoice "status" bucketing below
// is best-effort against the documented enum (see prisma/schema.prisma comments
// on Quote.status/Invoice.status) since exact real string values for every
// account haven't been enumerated; matching is done by substring so minor
// variations (case, wording) still classify correctly.
// ---------------------------------------------------------------------------

type QuoteRow = { status: string; isConverted: boolean; isExpired: boolean; value: number };
type InvoiceRow = { status: string; amount: number; amountPaid: number; isPaid: boolean; dueAt: Date | null };

function classifyQuote(q: QuoteRow): "accepted" | "declined" | "archived" | "open" {
  if (q.isConverted) return "accepted";
  const s = q.status.toLowerCase();
  if (s.includes("reject") || s.includes("declin")) return "declined";
  if (q.isExpired || s.includes("expir") || s.includes("void") || s.includes("cancel") || s.includes("archiv")) {
    return "archived";
  }
  return "open";
}

function classifyInvoice(inv: InvoiceRow): "fully_paid" | "partially_paid" | "open" | "archived" {
  const s = inv.status.toLowerCase();
  if (s.includes("void") || s.includes("cancel") || s.includes("archiv")) return "archived";
  if (inv.isPaid || inv.amountPaid >= inv.amount) return "fully_paid";
  if (inv.amountPaid > 0) return "partially_paid";
  return "open";
}

export interface QuoteBreakdown {
  total: number;
  totalValue: number;
  accepted: { count: number; value: number; rate: number };
  declined: { count: number; value: number; rate: number };
  open: { count: number; value: number; rate: number };
  archived: { count: number; value: number; rate: number };
}

export async function computeQuoteBreakdown(customerId: string, range: DateRange): Promise<QuoteBreakdown> {
  const quotes = await prisma.quote.findMany({
    where: { customerId, estimateAt: { gte: range.start, lte: range.end } },
  });

  const buckets = {
    accepted: { count: 0, value: 0 },
    declined: { count: 0, value: 0 },
    open: { count: 0, value: 0 },
    archived: { count: 0, value: 0 },
  };
  let totalValue = 0;

  for (const q of quotes) {
    const value = Number(q.value);
    totalValue += value;
    const bucket = classifyQuote({ status: q.status, isConverted: q.isConverted, isExpired: q.isExpired, value });
    buckets[bucket].count += 1;
    buckets[bucket].value += value;
  }

  const total = quotes.length;
  const rate = (n: number) => (total ? n / total : 0);
  return {
    total,
    totalValue,
    accepted: { ...buckets.accepted, rate: rate(buckets.accepted.count) },
    declined: { ...buckets.declined, rate: rate(buckets.declined.count) },
    open: { ...buckets.open, rate: rate(buckets.open.count) },
    archived: { ...buckets.archived, rate: rate(buckets.archived.count) },
  };
}

export interface InvoiceBreakdown {
  total: number;
  totalValue: number;
  totalCollected: number;
  collectionRate: number;
  fullyPaid: { count: number; value: number; rate: number };
  partiallyPaid: { count: number; collected: number; outstanding: number };
  open: { count: number; value: number; agedOver60Count: number; agedOver60Value: number };
  archived: { count: number; value: number; rate: number };
}

export async function computeInvoiceBreakdown(customerId: string, range: DateRange): Promise<InvoiceBreakdown> {
  const invoices = await prisma.invoice.findMany({
    where: { customerId, issuedAt: { gte: range.start, lte: range.end } },
  });

  let totalValue = 0;
  let totalCollected = 0;
  const fullyPaid = { count: 0, value: 0 };
  const partiallyPaid = { count: 0, collected: 0, outstanding: 0 };
  const open = { count: 0, value: 0, agedOver60Count: 0, agedOver60Value: 0 };
  const archived = { count: 0, value: 0 };
  const now = Date.now();

  for (const inv of invoices) {
    const amount = Number(inv.amount);
    const paid = Number(inv.amountPaid);
    totalValue += amount;
    totalCollected += paid;

    const bucket = classifyInvoice({ status: inv.status, amount, amountPaid: paid, isPaid: inv.isPaid, dueAt: inv.dueAt });
    if (bucket === "fully_paid") {
      fullyPaid.count += 1;
      fullyPaid.value += amount;
    } else if (bucket === "partially_paid") {
      partiallyPaid.count += 1;
      partiallyPaid.collected += paid;
      partiallyPaid.outstanding += amount - paid;
    } else if (bucket === "archived") {
      archived.count += 1;
      archived.value += amount;
    } else {
      open.count += 1;
      open.value += amount;
      if (inv.dueAt) {
        const daysPastDue = (now - inv.dueAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysPastDue > 60) {
          open.agedOver60Count += 1;
          open.agedOver60Value += amount - paid;
        }
      }
    }
  }

  const total = invoices.length;
  return {
    total,
    totalValue,
    totalCollected,
    collectionRate: totalValue ? totalCollected / totalValue : 0,
    fullyPaid: { ...fullyPaid, rate: total ? fullyPaid.count / total : 0 },
    partiallyPaid,
    open,
    archived: { ...archived, rate: total ? archived.count / total : 0 },
  };
}

export interface JobCategoryShare {
  name: string;
  count: number;
  pct: number;
}

/** Top N job categories by count in the period, ranked by volume. */
export async function computeTopJobCategories(
  customerId: string,
  range: DateRange,
  topN = 3
): Promise<JobCategoryShare[]> {
  const jobs = await prisma.job.findMany({
    where: { customerId, createdAt: { gte: range.start, lte: range.end } },
    select: { serviceType: true },
  });

  const counts = new Map<string, number>();
  for (const j of jobs) {
    const name = j.serviceType ?? "Unspecified";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const total = jobs.length;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name, count]) => ({ name, count, pct: total ? count / total : 0 }));
}

/** Every job category in the period, ranked by volume (topN omitted). */
export async function computeAllJobCategories(customerId: string, range: DateRange): Promise<JobCategoryShare[]> {
  return computeTopJobCategories(customerId, range, Infinity);
}

export interface RecommendationSignal {
  key: string;
  /** Short, punchy heading — safe to show as-is if the AI engine is disabled/unavailable. */
  title: string;
  /** Full sentence with the real numbers already filled in — this is what the AI engine
   * is allowed to rewrite/personalize, and what validateNoInventedNumbers() checks against. */
  detail: string;
}

export interface RecommendationEvidence {
  quotesTotal: number;
  quotesAcceptanceRate: number;
  quotesOpenValue: number;
  invoicesAgedOver60Count: number;
  invoicesAgedOver60Value: number;
  onlinePaymentShare: number;
  paymentsTotalValue: number;
  activeWorkflowCount: number;
  totalWorkflowCount: number;
  workflowsNeedingAttention: number;
  jobsTotal: number;
}

/**
 * Deterministic candidate recommendations ranked by how strongly the account's own
 * numbers support each one. Always returns up to 4 signal-backed items; callers pad
 * with an evergreen filler (e.g. "establish a regular reporting cadence") if fewer
 * than 4 signals fire. This is the fallback used verbatim when the AI engine is off,
 * and the only numeric grounding the AI engine is allowed to draw on when it's on.
 */
export function computeRecommendationSignals(evidence: RecommendationEvidence): RecommendationSignal[] {
  const signals: RecommendationSignal[] = [];

  if (evidence.quotesTotal >= 5 && evidence.quotesAcceptanceRate < 0.3 && evidence.quotesOpenValue > 0) {
    signals.push({
      key: "quote_conversion_low",
      title: "Improve Quote Follow-Up",
      detail: `Only ${(evidence.quotesAcceptanceRate * 100).toFixed(0)}% of ${evidence.quotesTotal} quotes converted this period, leaving $${(evidence.quotesOpenValue / 1_000_000).toFixed(2)}M in open pipeline value — tighter follow-up and tiered (Good-Better-Best) proposals are the fastest lever here.`,
    });
  }

  if (evidence.invoicesAgedOver60Value > 5000) {
    signals.push({
      key: "invoice_aging_high",
      title: "Turn On Zuper Pay",
      detail: `$${(evidence.invoicesAgedOver60Value / 1_000_000).toFixed(2)}M across ${evidence.invoicesAgedOver60Count} invoice(s) is aged over 60 days — Zuper Pay's Tap-to-Pay and payment links speed up collections directly from the invoice.`,
    });
  } else if (evidence.paymentsTotalValue > 20000 && evidence.onlinePaymentShare < 0.2) {
    signals.push({
      key: "zuper_pay_opportunity",
      title: "Turn On Zuper Pay",
      detail: `$${(evidence.paymentsTotalValue / 1_000_000).toFixed(2)}M in payments were collected this period with only ${(evidence.onlinePaymentShare * 100).toFixed(0)}% paid digitally — Zuper Pay consolidates this with lower fees and faster payout.`,
    });
  }

  if (evidence.workflowsNeedingAttention > 0) {
    signals.push({
      key: "workflows_need_attention",
      title: "Fix Flagged Workflows",
      detail: `${evidence.workflowsNeedingAttention} workflow(s) are flagged by Workflow Builder as needing attention — a broken automation silently pushes that work back onto the team, so these are worth fixing first.`,
    });
  }

  if (evidence.totalWorkflowCount === 0 && evidence.jobsTotal > 50) {
    signals.push({
      key: "no_workflows",
      title: "Adopt Workflow Builder",
      detail: `${evidence.jobsTotal} jobs ran this period with zero automation configured — Workflow Builder removes manual re-entry across status changes, notifications, and record syncing.`,
    });
  } else if (evidence.totalWorkflowCount > 0 && evidence.activeWorkflowCount < evidence.totalWorkflowCount) {
    const inactive = evidence.totalWorkflowCount - evidence.activeWorkflowCount;
    signals.push({
      key: "inactive_workflows",
      title: "Review Inactive Workflows",
      detail: `${inactive} of ${evidence.totalWorkflowCount} configured workflow(s) are currently inactive — worth a quick review to confirm they're intentionally retired rather than quietly broken.`,
    });
  }

  return signals;
}

export interface WorkflowRow {
  name: string;
  isActive: boolean;
  isLive: boolean;
  needsAttention: boolean;
  triggerName: string | null;
  stepCount: number;
  lastExecutionStatus: string | null;
  lastExecutionTime: Date | null;
}

export type AutomationCategory = "notifications" | "recordUpdates" | "recordCreation" | "integrations" | "lookups" | "logic";

/** Categories that are plumbing inside a workflow (branching, code, lookups) rather than manual work it replaces. */
export const PLUMBING_CATEGORIES: AutomationCategory[] = ["lookups", "logic"];

export const AUTOMATION_CATEGORY_LABELS: Record<AutomationCategory, string> = {
  notifications: "Emails & notifications",
  recordUpdates: "Record updates",
  recordCreation: "Records created (e.g. invoices)",
  integrations: "External system calls",
  lookups: "Data lookups",
  logic: "Logic & data handling",
};

/** Buckets a Workflow Builder action_key into the kind of manual work it replaces. */
export function categorizeAction(actionKey: string): AutomationCategory {
  const k = actionKey.toLowerCase();
  if (k.includes("email") || k.includes("sms") || k.includes("notification")) return "notifications";
  if (k === "zuper_update" || k === "zuper_custom_field") return "recordUpdates";
  if (k === "zuper_create") return "recordCreation";
  if (k === "http_request") return "integrations";
  if (k === "zuper_get_record" || k === "zuper_job_details") return "lookups";
  return "logic";
}

export interface WorkflowSummary {
  total: number;
  /** Active + published — the only workflows that actually run. */
  live: number;
  active: number;
  inactive: number;
  /** Never published (draft only). */
  drafts: number;
  /** Live workflows whose most recent run falls inside the report period — a floor on activity, not a run count. */
  ranInPeriod: number;
  needsAttention: number;
  aiGenerated: number;
  /** Automated ACTION steps across live workflows. */
  liveSteps: number;
  /** Live workflows started by an inbound webhook from another system. */
  webhookTriggered: number;
  /** Live workflows' triggers, most common first. */
  triggers: { name: string; count: number }[];
  /** Live workflows' steps by kind of work automated, largest first (empty categories omitted). */
  categories: { key: AutomationCategory; label: string; steps: number; workflows: number }[];
  /** Live workflows first, then most recently run. Run counts/success rates aren't exposed by the API (see prisma Workflow comment). */
  workflows: WorkflowRow[];
}

export interface WorkflowRecord {
  id: string;
  name: string;
  isActive: boolean;
  isPublished: boolean;
  isAiGenerated: boolean;
  needsAttention: boolean;
  triggerName: string | null;
  triggerKey: string | null;
  stepCount: number;
  actionKeys: string[];
  lastExecutionStatus: string | null;
  lastExecutionTime: Date | null;
}

export async function computeWorkflowSummary(customerId: string, range: DateRange): Promise<WorkflowSummary> {
  return summarizeWorkflows(await prisma.workflow.findMany({ where: { customerId } }), range);
}

export function summarizeWorkflows(rows: WorkflowRecord[], range: DateRange): WorkflowSummary {
  const isLive = (w: WorkflowRecord) => w.isActive && w.isPublished;
  const live = rows.filter(isLive);

  const triggerCounts = new Map<string, number>();
  const categorySteps = new Map<AutomationCategory, { steps: number; workflows: Set<string> }>();
  for (const w of live) {
    const trigger = w.triggerName ?? "Unknown trigger";
    triggerCounts.set(trigger, (triggerCounts.get(trigger) ?? 0) + 1);
    for (const key of w.actionKeys) {
      const cat = categorizeAction(key);
      const entry = categorySteps.get(cat) ?? { steps: 0, workflows: new Set<string>() };
      entry.steps += 1;
      entry.workflows.add(w.id);
      categorySteps.set(cat, entry);
    }
  }

  const time = (d: Date | null) => d?.getTime() ?? 0;
  const workflows = [...rows]
    .sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || time(b.lastExecutionTime) - time(a.lastExecutionTime))
    .map((w) => ({
      name: w.name,
      isActive: w.isActive,
      isLive: isLive(w),
      needsAttention: w.needsAttention,
      triggerName: w.triggerName,
      stepCount: w.stepCount,
      lastExecutionStatus: w.lastExecutionStatus,
      lastExecutionTime: w.lastExecutionTime,
    }));

  return {
    total: rows.length,
    live: live.length,
    active: rows.filter((w) => w.isActive).length,
    inactive: rows.filter((w) => !w.isActive).length,
    drafts: rows.filter((w) => !w.isPublished).length,
    ranInPeriod: live.filter((w) => w.lastExecutionTime && w.lastExecutionTime >= range.start && w.lastExecutionTime <= range.end).length,
    needsAttention: rows.filter((w) => w.needsAttention).length,
    aiGenerated: rows.filter((w) => w.isAiGenerated).length,
    liveSteps: live.reduce((sum, w) => sum + w.stepCount, 0),
    webhookTriggered: live.filter((w) => w.triggerKey === "external_webhook").length,
    triggers: [...triggerCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    categories: [...categorySteps.entries()]
      .map(([key, v]) => ({ key, label: AUTOMATION_CATEGORY_LABELS[key], steps: v.steps, workflows: v.workflows.size }))
      .sort((a, b) => b.steps - a.steps),
    workflows,
  };
}

export interface FootprintComparison {
  currentJobs: number;
  priorJobs: number;
  currentQuotes: number;
  priorQuotes: number;
  currentInvoices: number;
  priorInvoices: number;
  quoteValue: number;
  invoiceValue: number;
  propertiesCount: number;
  totalUserIdentities: number;
  activeUserCount: number;
  currentLabel: string;
  priorLabel: string;
}

/**
 * Compares "this calendar year to date" against "the prior full calendar year" —
 * matches the template's "2026 YTD vs full-year 2025" framing. propertiesCount is
 * approximated from the synced end-customer ledger (Zuper has no dedicated
 * Properties module wired up yet); totalUserIdentities/activeUserCount come from
 * all synced Technician rows for the report period, not a licensed-seat count
 * (that's a billing concept, not exposed via the customer's own API key).
 */
export async function computeFootprintComparison(customerId: string, range: DateRange): Promise<FootprintComparison> {
  const currentYearStart = new Date(Date.UTC(range.end.getUTCFullYear(), 0, 1));
  const priorYearStart = new Date(Date.UTC(range.end.getUTCFullYear() - 1, 0, 1));
  const priorYearEnd = new Date(Date.UTC(range.end.getUTCFullYear(), 0, 1));

  const [
    currentJobs,
    priorJobs,
    currentQuotes,
    priorQuotes,
    currentInvoices,
    priorInvoices,
    quoteValueAgg,
    invoiceValueAgg,
    propertiesCount,
    technicians,
  ] = await Promise.all([
    prisma.job.count({ where: { customerId, createdAt: { gte: currentYearStart, lte: range.end } } }),
    prisma.job.count({ where: { customerId, createdAt: { gte: priorYearStart, lt: priorYearEnd } } }),
    prisma.quote.count({ where: { customerId, estimateAt: { gte: currentYearStart, lte: range.end } } }),
    prisma.quote.count({ where: { customerId, estimateAt: { gte: priorYearStart, lt: priorYearEnd } } }),
    prisma.invoice.count({ where: { customerId, issuedAt: { gte: currentYearStart, lte: range.end } } }),
    prisma.invoice.count({ where: { customerId, issuedAt: { gte: priorYearStart, lt: priorYearEnd } } }),
    prisma.quote.aggregate({
      where: { customerId, estimateAt: { gte: range.start, lte: range.end } },
      _sum: { value: true },
    }),
    prisma.invoice.aggregate({
      where: { customerId, issuedAt: { gte: range.start, lte: range.end } },
      _sum: { amount: true },
    }),
    prisma.endCustomerLedger.count({ where: { customerId } }),
    prisma.technician.findMany({
      where: { customerId, periodStart: range.start, periodEnd: range.end },
      select: { isActive: true },
    }),
  ]);

  return {
    currentJobs,
    priorJobs,
    currentQuotes,
    priorQuotes,
    currentInvoices,
    priorInvoices,
    quoteValue: Number(quoteValueAgg._sum.value ?? 0),
    invoiceValue: Number(invoiceValueAgg._sum.amount ?? 0),
    propertiesCount,
    totalUserIdentities: technicians.length,
    activeUserCount: technicians.filter((t) => t.isActive).length,
    currentLabel: `${currentYearStart.getUTCFullYear()} YTD`,
    priorLabel: `Full-year ${priorYearStart.getUTCFullYear()}`,
  };
}

export interface QuarterBucket {
  label: string;
  quotesAcceptedValue: number;
  quotesDeclinedValue: number;
  acceptanceRatePct: number;
  invoicesInvoicedValue: number;
  invoicesCollectedValue: number;
  collectionRatePct: number;
}

function quarterLabel(date: Date): string {
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `Q${q}`;
}

function quarterStart(date: Date): Date {
  const q = Math.floor(date.getUTCMonth() / 3);
  return new Date(Date.UTC(date.getUTCFullYear(), q * 3, 1));
}

/** Trailing N calendar quarters ending in the quarter containing range.end, oldest first. */
export async function computeQuarterlySeries(
  customerId: string,
  range: DateRange,
  quarterCount = 4
): Promise<QuarterBucket[]> {
  const endQuarterStart = quarterStart(range.end);
  const buckets: QuarterBucket[] = [];

  for (let i = quarterCount - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(endQuarterStart.getUTCFullYear(), endQuarterStart.getUTCMonth() - i * 3, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1));

    const [quotes, invoices] = await Promise.all([
      prisma.quote.findMany({
        where: { customerId, estimateAt: { gte: start, lt: end } },
        select: { status: true, isConverted: true, isExpired: true, value: true },
      }),
      prisma.invoice.findMany({
        where: { customerId, issuedAt: { gte: start, lt: end } },
        select: { amount: true, amountPaid: true },
      }),
    ]);

    let acceptedValue = 0;
    let declinedValue = 0;
    let acceptedCount = 0;
    let decidedCount = 0; // accepted + declined, denominator for acceptance rate
    for (const q of quotes) {
      const value = Number(q.value);
      const bucket = classifyQuote({ status: q.status, isConverted: q.isConverted, isExpired: q.isExpired, value });
      if (bucket === "accepted") {
        acceptedValue += value;
        acceptedCount += 1;
        decidedCount += 1;
      } else if (bucket === "declined") {
        declinedValue += value;
        decidedCount += 1;
      }
    }

    let invoicedValue = 0;
    let collectedValue = 0;
    for (const inv of invoices) {
      invoicedValue += Number(inv.amount);
      collectedValue += Number(inv.amountPaid);
    }

    buckets.push({
      label: quarterLabel(start),
      quotesAcceptedValue: acceptedValue,
      quotesDeclinedValue: declinedValue,
      acceptanceRatePct: decidedCount ? (acceptedCount / decidedCount) * 100 : 0,
      invoicesInvoicedValue: invoicedValue,
      invoicesCollectedValue: collectedValue,
      collectionRatePct: invoicedValue ? (collectedValue / invoicedValue) * 100 : 0,
    });
  }

  return buckets;
}

export interface MonthBucket {
  label: string; // "Aug-2025"
  avgInvoiceValue: number;
  unacceptedQuoteValue: number;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Trailing N calendar months ending in the month containing range.end, oldest first. */
export async function computeMonthlySeries(customerId: string, range: DateRange, monthCount = 13): Promise<MonthBucket[]> {
  const endMonthStart = new Date(Date.UTC(range.end.getUTCFullYear(), range.end.getUTCMonth(), 1));
  const buckets: MonthBucket[] = [];

  for (let i = monthCount - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(endMonthStart.getUTCFullYear(), endMonthStart.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

    const [invoices, quotes] = await Promise.all([
      prisma.invoice.findMany({
        where: { customerId, issuedAt: { gte: start, lt: end } },
        select: { amount: true },
      }),
      prisma.quote.findMany({
        where: { customerId, estimateAt: { gte: start, lt: end } },
        select: { status: true, isConverted: true, isExpired: true, value: true },
      }),
    ]);

    const avgInvoiceValue = invoices.length
      ? invoices.reduce((sum, inv) => sum + Number(inv.amount), 0) / invoices.length
      : 0;

    const unacceptedQuoteValue = quotes.reduce((sum, q) => {
      const value = Number(q.value);
      const bucket = classifyQuote({ status: q.status, isConverted: q.isConverted, isExpired: q.isExpired, value });
      return bucket === "open" || bucket === "declined" ? sum + value : sum;
    }, 0);

    buckets.push({
      label: `${MONTH_ABBR[start.getUTCMonth()]}-${start.getUTCFullYear()}`,
      avgInvoiceValue,
      unacceptedQuoteValue,
    });
  }

  return buckets;
}
