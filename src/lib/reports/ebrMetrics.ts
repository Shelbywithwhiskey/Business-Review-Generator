import { prisma } from "@/lib/db";
import type { DateRange } from "@/lib/zuper/modules";
import { classifyInvoice, classifyQuote, isSentQuote } from "./classify";

// ---------------------------------------------------------------------------
// Metrics specific to the EBR/QBR PPTX template (see lib/pptx/*). Deterministic,
// no AI — same rule as lib/analytics.ts. Quote/invoice outcomes come from the
// shared rules in ./classify so every slide agrees on what "accepted" and
// "voided" mean.
// ---------------------------------------------------------------------------

export interface QuoteBreakdown {
  total: number;
  totalValue: number;
  /** Quotes that left draft — the denominator for acceptance and decline rates. */
  sent: number;
  drafts: number;
  /** rate = count ÷ sent quotes. */
  accepted: { count: number; value: number; rate: number };
  /** rate = count ÷ sent quotes. */
  declined: { count: number; value: number; rate: number };
  /** Awaiting response, plus drafts. rate = count ÷ all quotes. */
  open: { count: number; value: number; rate: number };
  /** Canceled, archived or expired. rate = count ÷ all quotes. */
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
  let sent = 0;
  let drafts = 0;

  for (const q of quotes) {
    const value = Number(q.value);
    totalValue += value;
    const outcome = classifyQuote(q);
    if (isSentQuote(outcome)) sent += 1;
    else drafts += 1;
    const bucket = outcome === "draft" ? "open" : outcome;
    buckets[bucket].count += 1;
    buckets[bucket].value += value;
  }

  const total = quotes.length;
  const ofSent = (n: number) => (sent ? n / sent : 0);
  const ofAll = (n: number) => (total ? n / total : 0);
  return {
    total,
    totalValue,
    sent,
    drafts,
    accepted: { ...buckets.accepted, rate: ofSent(buckets.accepted.count) },
    declined: { ...buckets.declined, rate: ofSent(buckets.declined.count) },
    open: { ...buckets.open, rate: ofAll(buckets.open.count) },
    archived: { ...buckets.archived, rate: ofAll(buckets.archived.count) },
  };
}

export interface InvoiceBreakdown {
  /** All invoices dated in the period, including voided ones. */
  total: number;
  /** Invoices that count toward value and collections (voided excluded). */
  billable: number;
  totalValue: number;
  totalCollected: number;
  collectionRate: number;
  /** rate = count ÷ billable invoices. */
  fullyPaid: { count: number; value: number; rate: number };
  partiallyPaid: { count: number; collected: number; outstanding: number };
  open: { count: number; value: number };
  /** Outstanding balance (open + partially paid) more than 60 days past its due date, as of today. */
  agedOver60: { count: number; value: number };
  /** Voided / canceled / archived — excluded from value and collection rate. rate = count ÷ all invoices. */
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
  const open = { count: 0, value: 0 };
  const agedOver60 = { count: 0, value: 0 };
  const archived = { count: 0, value: 0 };
  const now = Date.now();

  for (const inv of invoices) {
    const amount = Number(inv.amount);
    const paid = Number(inv.amountPaid);
    const bucket = classifyInvoice({ status: inv.status, amount, amountPaid: paid, isPaid: inv.isPaid });
    if (bucket === "void") {
      archived.count += 1;
      archived.value += amount;
      continue;
    }
    totalValue += amount;
    totalCollected += Math.min(paid, amount);

    if (bucket === "fully_paid") {
      fullyPaid.count += 1;
      fullyPaid.value += amount;
      continue;
    }
    if (bucket === "partially_paid") {
      partiallyPaid.count += 1;
      partiallyPaid.collected += paid;
      partiallyPaid.outstanding += amount - paid;
    } else {
      open.count += 1;
      open.value += amount;
    }
    if (inv.dueAt && (now - inv.dueAt.getTime()) / 864e5 > 60) {
      agedOver60.count += 1;
      agedOver60.value += amount - paid;
    }
  }

  const total = invoices.length;
  const billable = total - archived.count;
  return {
    total,
    billable,
    totalValue,
    totalCollected,
    collectionRate: totalValue ? totalCollected / totalValue : 0,
    fullyPaid: { ...fullyPaid, rate: billable ? fullyPaid.count / billable : 0 },
    partiallyPaid,
    open,
    agedOver60,
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
  /** From Workflow Builder execution history (0 when not synced). */
  workflowRunsFailed: number;
  /** Failed ÷ (completed + failed) runs. */
  workflowFailureRate: number;
  topWorkflowError: string | null;
  /** Jobs due in the period: completed on time ÷ eligible (null when jobs carry no deadline). */
  onTimeRate?: number | null;
  onTimeEligible?: number;
  overdueOpenJobs?: number;
  /** Completed jobs with an invoice attached ÷ completed jobs (null when not measurable). */
  completedInvoicedRate?: number | null;
  completedJobs?: number;
  contractsExpiring90d?: number;
  missedCalls?: number;
}

/**
 * Deterministic candidate recommendations ranked by how strongly the account's own
 * numbers support each one. Always returns up to 4 signal-backed items; callers pad
 * with an evergreen filler (e.g. "establish a regular reporting cadence") if fewer
 * than 4 signals fire. This is the fallback used verbatim when the AI engine is off,
 * and the only numeric grounding the AI engine is allowed to draw on when it's on.
 */
function money(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function computeRecommendationSignals(evidence: RecommendationEvidence): RecommendationSignal[] {
  const signals: RecommendationSignal[] = [];

  if (evidence.quotesTotal >= 5 && evidence.quotesAcceptanceRate < 0.3 && evidence.quotesOpenValue > 0) {
    signals.push({
      key: "quote_conversion_low",
      title: "Improve Quote Follow-Up",
      detail: `Only ${(evidence.quotesAcceptanceRate * 100).toFixed(0)}% of ${evidence.quotesTotal.toLocaleString("en-US")} sent quotes were accepted this period, with ${money(evidence.quotesOpenValue)} still open — tighter follow-up and tiered (Good-Better-Best) proposals are the fastest lever here.`,
    });
  }

  if (evidence.invoicesAgedOver60Value > 5000) {
    signals.push({
      key: "invoice_aging_high",
      title: "Collect Overdue Invoices",
      detail: `${money(evidence.invoicesAgedOver60Value)} across ${evidence.invoicesAgedOver60Count} invoice(s) is more than 60 days past due — Zuper Pay payment links on every reminder, or AR Agent working the overdue list, shorten collection.`,
    });
  } else if (evidence.paymentsTotalValue > 20000 && evidence.onlinePaymentShare < 0.2) {
    signals.push({
      key: "zuper_pay_opportunity",
      title: "Move Payments Online",
      detail: `${money(evidence.paymentsTotalValue)} in payments were collected this period with only ${(evidence.onlinePaymentShare * 100).toFixed(0)}% paid online — Zuper Pay (Tap to Pay, payment links, card on file) brings collection into the same system as the invoice.`,
    });
  }

  if (evidence.onTimeRate != null && (evidence.onTimeEligible ?? 0) >= 20 && evidence.onTimeRate < 0.7) {
    signals.push({
      key: "on_time_low",
      title: "Lift On-Time Completion",
      detail: `${(evidence.onTimeRate * 100).toFixed(0)}% of ${(evidence.onTimeEligible ?? 0).toLocaleString("en-US")} jobs due this period were completed by their deadline, with ${(evidence.overdueOpenJobs ?? 0).toLocaleString("en-US")} still open past due — dispatch board reviews and status-based alerts in Workflow Builder keep late jobs visible.`,
    });
  }

  if (evidence.completedInvoicedRate != null && (evidence.completedJobs ?? 0) >= 20 && evidence.completedInvoicedRate < 0.7) {
    signals.push({
      key: "completed_not_invoiced",
      title: "Invoice Work on Completion",
      detail: `Only ${(evidence.completedInvoicedRate * 100).toFixed(0)}% of ${(evidence.completedJobs ?? 0).toLocaleString("en-US")} completed jobs have an invoice attached in Zuper — auto-creating the invoice when a job completes closes the gap between finishing work and billing it.`,
    });
  }

  if ((evidence.contractsExpiring90d ?? 0) > 0) {
    signals.push({
      key: "contracts_expiring",
      title: "Renew Expiring Contracts",
      detail: `${evidence.contractsExpiring90d} service contract(s) expire in the next 90 days — a renewal workflow and reminder sequence protects that recurring revenue.`,
    });
  }

  if ((evidence.missedCalls ?? 0) >= 10) {
    signals.push({
      key: "missed_calls",
      title: "Answer Every Call",
      detail: `${evidence.missedCalls} calls through Zuper Connect were missed or went unanswered — CSR Agent answers overflow and after-hours calls and books the work.`,
    });
  }

  if (evidence.workflowRunsFailed >= 20 && evidence.workflowFailureRate >= 0.05) {
    signals.push({
      key: "workflow_runs_failing",
      title: "Fix Failing Automations",
      detail: `${evidence.workflowRunsFailed.toLocaleString("en-US")} workflow runs failed (${(evidence.workflowFailureRate * 100).toFixed(0)}% of runs that executed)${evidence.topWorkflowError ? `, most often "${evidence.topWorkflowError}"` : ""} — each failed run is a step the team has to catch and do by hand.`,
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
  endCustomerCount: number;
  totalUserIdentities: number;
  activeUserCount: number;
  currentLabel: string;
  priorLabel: string;
}

/**
 * Compares "this calendar year to date" against "the prior full calendar year" —
 * matches the template's "YTD vs full prior year" framing. propertiesCount is the
 * synced Property count (GET /property); endCustomerCount is reported separately.
 * totalUserIdentities/activeUserCount come from all synced Technician rows for the
 * report period, not a licensed-seat count (that's a billing concept, not exposed
 * via the customer's own API key).
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
    periodInvoices,
    propertiesCount,
    endCustomerCount,
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
    prisma.invoice.findMany({
      where: { customerId, issuedAt: { gte: range.start, lte: range.end } },
      select: { amount: true, amountPaid: true, status: true, isPaid: true },
    }),
    prisma.property.count({ where: { customerId } }),
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
    invoiceValue: periodInvoices
      .filter((inv) => classifyInvoice({ status: inv.status, amount: Number(inv.amount), amountPaid: Number(inv.amountPaid), isPaid: inv.isPaid }) !== "void")
      .reduce((sum, inv) => sum + Number(inv.amount), 0),
    propertiesCount,
    endCustomerCount,
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
  /** Non-draft quotes dated in the quarter — the acceptance-rate denominator. */
  quotesSent: number;
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
        select: { amount: true, amountPaid: true, status: true, isPaid: true },
      }),
    ]);

    // Same definitions as the period totals: acceptance = accepted ÷ sent (non-draft) quotes.
    let acceptedValue = 0;
    let declinedValue = 0;
    let acceptedCount = 0;
    let sentCount = 0;
    for (const q of quotes) {
      const value = Number(q.value);
      const outcome = classifyQuote(q);
      if (isSentQuote(outcome)) sentCount += 1;
      if (outcome === "accepted") {
        acceptedValue += value;
        acceptedCount += 1;
      } else if (outcome === "declined") {
        declinedValue += value;
      }
    }

    let invoicedValue = 0;
    let collectedValue = 0;
    for (const inv of invoices) {
      const amount = Number(inv.amount);
      const paid = Number(inv.amountPaid);
      if (classifyInvoice({ status: inv.status, amount, amountPaid: paid, isPaid: inv.isPaid }) === "void") continue;
      invoicedValue += amount;
      collectedValue += Math.min(paid, amount);
    }

    buckets.push({
      label: `${quarterLabel(start)} ${String(start.getUTCFullYear()).slice(2)}`,
      quotesAcceptedValue: acceptedValue,
      quotesDeclinedValue: declinedValue,
      quotesSent: sentCount,
      acceptanceRatePct: sentCount ? (acceptedCount / sentCount) * 100 : 0,
      invoicesInvoicedValue: invoicedValue,
      invoicesCollectedValue: collectedValue,
      collectionRatePct: invoicedValue ? (collectedValue / invoicedValue) * 100 : 0,
    });
  }

  return buckets;
}

export interface MonthBucket {
  label: string; // "Aug-2025"
  /** Mean value of non-voided invoices dated in the month. */
  avgInvoiceValue: number;
  invoiceCount: number;
  /** Open, draft or declined quotes dated in the month. */
  unacceptedQuoteValue: number;
  acceptedQuoteValue: number;
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
        select: { amount: true, amountPaid: true, status: true, isPaid: true },
      }),
      prisma.quote.findMany({
        where: { customerId, estimateAt: { gte: start, lt: end } },
        select: { status: true, isConverted: true, isExpired: true, value: true },
      }),
    ]);

    const billable = invoices.filter(
      (inv) => classifyInvoice({ status: inv.status, amount: Number(inv.amount), amountPaid: Number(inv.amountPaid), isPaid: inv.isPaid }) !== "void"
    );
    const avgInvoiceValue = billable.length ? billable.reduce((sum, inv) => sum + Number(inv.amount), 0) / billable.length : 0;

    let acceptedQuoteValue = 0;
    const unacceptedQuoteValue = quotes.reduce((sum, q) => {
      const outcome = classifyQuote(q);
      if (outcome === "accepted") acceptedQuoteValue += Number(q.value);
      return outcome === "open" || outcome === "draft" || outcome === "declined" ? sum + Number(q.value) : sum;
    }, 0);

    buckets.push({
      label: `${MONTH_ABBR[start.getUTCMonth()]}-${start.getUTCFullYear()}`,
      avgInvoiceValue,
      invoiceCount: billable.length,
      unacceptedQuoteValue,
      acceptedQuoteValue,
    });
  }

  return buckets;
}
