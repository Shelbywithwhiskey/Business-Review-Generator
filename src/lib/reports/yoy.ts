import { prisma } from "@/lib/db";
import type { DateRange } from "@/lib/zuper/modules";
import { CATALOG } from "@/lib/zuper/catalog";
import { classifyInvoice, classifyQuote, isSentQuote } from "./classify";
import type { Callout } from "./callouts";

// ---------------------------------------------------------------------------
// Year over year: the review period against the same period one year earlier,
// for accounts that were already on Zuper then. Two lenses an account manager
// leads with: usage (how much work runs through Zuper) and adoption (how many
// Zuper capabilities the business actually uses). Deterministic, from the
// synced records (the sync pulls full history). Rates that need time to settle
// — quote decisions, collections, days to pay — only count records at least
// MATURE_DAYS old in both windows, so this year's still-open invoices aren't
// compared with last year's settled ones.
// ---------------------------------------------------------------------------

const DAY = 864e5;
const MATURE_DAYS = 45;
/** A capability counts as "in use" in a window with at least this many records. */
const ADOPTION_MIN = 3;

export interface YoyMetric {
  key: string;
  label: string;
  unit: "count" | "money" | "pct" | "days";
  before: number;
  now: number;
  better: "up" | "down";
  /** Relative change for counts/money/days; percentage-point difference for pct. */
  change: number;
  improved: boolean;
  /** Big enough to call out: ≥10% (counts/money/days) or ≥3 points (pct). */
  material: boolean;
  definition: string;
}

export interface YearOverYear {
  eligible: boolean;
  /** Why not, when not eligible. */
  reason: string | null;
  current: DateRange;
  previous: DateRange;
  metrics: YoyMetric[];
  adoption: { before: string[]; now: string[]; added: string[]; dropped: string[] };
  /** Wins (improvements, new capabilities) and watch items (declines) for the deck. */
  callouts: Callout[];
}

function shiftYear(d: Date, years: number): Date {
  const x = new Date(d);
  x.setUTCFullYear(x.getUTCFullYear() + years);
  return x;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const fmtCount = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtMoney = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n).toLocaleString("en-US")}`);
const fmtPct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function formatYoyValue(m: Pick<YoyMetric, "unit">, v: number): string {
  if (m.unit === "money") return fmtMoney(v);
  if (m.unit === "pct") return fmtPct(v);
  if (m.unit === "days") return `${v.toFixed(1)} days`;
  return fmtCount(v);
}

export function formatYoyChange(m: YoyMetric): string {
  if (m.unit === "pct") return `${m.change >= 0 ? "+" : "−"}${Math.abs(m.change * 100).toFixed(0)} pts`;
  return `${m.change >= 0 ? "+" : "−"}${Math.abs(m.change * 100).toFixed(0)}%`;
}

interface WindowStats {
  jobsCreated: number;
  jobsCompleted: number;
  recurring: number;
  fieldUsers: number;
  customersServed: number;
  customersAdded: number;
  cycleDays: number[];
  quotesSent: number;
  quotesAccepted: number;
  acceptedValue: number;
  invoices: number;
  invoiced: number;
  matureInvoiced: number;
  matureCollected: number;
  daysToPay: number[];
  payments: number;
  paymentsOnline: number;
}

export async function computeYearOverYear(customerId: string, current: DateRange): Promise<YearOverYear> {
  const previous: DateRange = { start: shiftYear(current.start, -1), end: shiftYear(current.end, -1) };
  const empty = (reason: string): YearOverYear => ({ eligible: false, reason, current, previous, metrics: [], adoption: { before: [], now: [], added: [], dropped: [] }, callouts: [] });

  // On Zuper since before (or within two weeks of) the start of last year's window — otherwise last year
  // only holds onboarding, and any comparison would just measure the ramp-up.
  const [firstJob, firstQuote, firstInvoice] = await Promise.all([
    prisma.job.aggregate({ where: { customerId }, _min: { createdAt: true } }),
    prisma.quote.aggregate({ where: { customerId }, _min: { estimateAt: true } }),
    prisma.invoice.aggregate({ where: { customerId }, _min: { issuedAt: true } }),
  ]);
  const goLive = [firstJob._min.createdAt, firstQuote._min.estimateAt, firstInvoice._min.issuedAt].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
  if (!goLive) return empty("No activity recorded yet.");
  if (goLive.getTime() > previous.start.getTime() + 14 * DAY) {
    return empty(`On Zuper since ${goLive.toISOString().slice(0, 7)} — a year-over-year comparison needs the account to have been live for the same period last year.`);
  }

  const span = { gte: previous.start, lte: current.end };
  const [jobs, quotes, invoices, payments, customersAdded, records, workflows] = await Promise.all([
    prisma.job.findMany({ where: { customerId, createdAt: span }, select: { createdAt: true, completedAt: true, status: true, isRecurring: true, technicianId: true, endCustomerId: true } }),
    prisma.quote.findMany({ where: { customerId, estimateAt: span }, select: { estimateAt: true, status: true, isConverted: true, isExpired: true, value: true } }),
    prisma.invoice.findMany({ where: { customerId, issuedAt: span }, select: { issuedAt: true, paidAt: true, amount: true, amountPaid: true, isPaid: true, status: true } }),
    prisma.payment.findMany({ where: { customerId, paidAt: span }, select: { paidAt: true, amount: true, paymentModeType: true } }),
    prisma.endCustomerLedger.findMany({ where: { customerId, createdInZuperAt: span }, select: { createdInZuperAt: true } }),
    prisma.zuperRecord.findMany({ where: { customerId, recordCreatedAt: span }, select: { module: true, recordCreatedAt: true } }),
    prisma.workflow.findMany({ where: { customerId }, select: { createdAt: true, isActive: true } }),
  ]);

  const windows = { before: previous, now: current } as const;
  const inWin = (d: Date | null | undefined, w: DateRange) => !!d && d >= w.start && d <= w.end;

  const stats = (w: DateRange): WindowStats => {
    // Settled cut-off at the same offset in both windows.
    const matureBy = new Date(w.end.getTime() - MATURE_DAYS * DAY);
    const s: WindowStats = { jobsCreated: 0, jobsCompleted: 0, recurring: 0, fieldUsers: 0, customersServed: 0, customersAdded: 0, cycleDays: [], quotesSent: 0, quotesAccepted: 0, acceptedValue: 0, invoices: 0, invoiced: 0, matureInvoiced: 0, matureCollected: 0, daysToPay: [], payments: 0, paymentsOnline: 0 };
    const techs = new Set<string>();
    const served = new Set<string>();
    for (const j of jobs) {
      if (!inWin(j.createdAt, w)) continue;
      s.jobsCreated += 1;
      if (j.isRecurring) s.recurring += 1;
      if (j.technicianId) techs.add(j.technicianId);
      if (j.endCustomerId) served.add(j.endCustomerId);
      if (j.status === "completed") {
        s.jobsCompleted += 1;
        if (j.completedAt) {
          const days = (j.completedAt.getTime() - j.createdAt.getTime()) / DAY;
          if (days >= 0) s.cycleDays.push(days);
        }
      }
    }
    s.fieldUsers = techs.size;
    s.customersServed = served.size;
    for (const q of quotes) {
      if (!inWin(q.estimateAt, w) || q.estimateAt > matureBy) continue;
      const o = classifyQuote(q);
      if (!isSentQuote(o)) continue;
      s.quotesSent += 1;
      if (o === "accepted") {
        s.quotesAccepted += 1;
        s.acceptedValue += Number(q.value);
      }
    }
    for (const inv of invoices) {
      if (!inWin(inv.issuedAt, w)) continue;
      const amount = Number(inv.amount);
      const paid = Number(inv.amountPaid);
      if (classifyInvoice({ status: inv.status, amount, amountPaid: paid, isPaid: inv.isPaid }) === "void") continue;
      s.invoices += 1;
      s.invoiced += amount;
      if (inv.issuedAt <= matureBy) {
        s.matureInvoiced += amount;
        s.matureCollected += Math.min(paid, amount);
        if (inv.paidAt) {
          const d = (inv.paidAt.getTime() - inv.issuedAt.getTime()) / DAY;
          if (d >= 0) s.daysToPay.push(d);
        }
      }
    }
    for (const p of payments) {
      if (!inWin(p.paidAt, w)) continue;
      s.payments += Number(p.amount);
      if (p.paymentModeType === "ONLINE") s.paymentsOnline += Number(p.amount);
    }
    s.customersAdded = customersAdded.filter((c) => inWin(c.createdInZuperAt, w)).length;
    return s;
  };
  const b = stats(windows.before);
  const n = stats(windows.now);

  // ---- Usage --------------------------------------------------------------------------------
  const metrics: YoyMetric[] = [];
  const add = (m: Omit<YoyMetric, "change" | "improved" | "material">) => {
    const change = m.unit === "pct" ? m.now - m.before : m.before ? (m.now - m.before) / m.before : 0;
    const improved = m.better === "up" ? m.now > m.before : m.now < m.before;
    const material = m.unit === "pct" ? Math.abs(change) >= 0.03 : Math.abs(change) >= 0.1;
    metrics.push({ ...m, change, improved, material });
  };
  if (b.jobsCreated >= 10) add({ key: "jobs", label: "Jobs created", unit: "count", before: b.jobsCreated, now: n.jobsCreated, better: "up", definition: "Jobs whose created date falls in each window." });
  if (b.jobsCompleted >= 10) add({ key: "completed", label: "Jobs completed", unit: "count", before: b.jobsCompleted, now: n.jobsCompleted, better: "up", definition: "Of the jobs created in each window, those now Completed or Closed." });
  if (b.jobsCreated >= 20 && n.jobsCreated >= 20)
    add({ key: "closeout", label: "Jobs closed out in Zuper", unit: "pct", before: b.jobsCompleted / b.jobsCreated, now: n.jobsCompleted / n.jobsCreated, better: "up", definition: "Completed ÷ created, for jobs created in each window." });
  if (b.fieldUsers >= 2) add({ key: "fieldUsers", label: "Team members assigned work", unit: "count", before: b.fieldUsers, now: n.fieldUsers, better: "up", definition: "Distinct primary assignees on jobs created in each window." });
  if (b.customersServed >= 10) add({ key: "served", label: "Customers served", unit: "count", before: b.customersServed, now: n.customersServed, better: "up", definition: "Distinct end customers with a job created in each window." });
  if (b.customersAdded >= 5) add({ key: "newCustomers", label: "New customers added", unit: "count", before: b.customersAdded, now: n.customersAdded, better: "up", definition: "End customers created in Zuper in each window." });
  if (b.jobsCreated >= 20 && (b.recurring > 0 || n.recurring > 0))
    add({ key: "recurring", label: "Jobs from recurring schedules", unit: "pct", before: b.recurring / b.jobsCreated, now: n.jobsCreated ? n.recurring / n.jobsCreated : 0, better: "up", definition: "Share of jobs created from a recurrence (is_recurrence)." });
  const bc = median(b.cycleDays);
  const nc = median(n.cycleDays);
  if (bc != null && nc != null && b.cycleDays.length >= 10 && n.cycleDays.length >= 10)
    add({ key: "cycle", label: "Days from job created to completed", unit: "days", before: bc, now: nc, better: "down", definition: "Median, for completed jobs created in each window." });
  if (b.quotesSent >= 10) add({ key: "quotesSent", label: "Quotes sent", unit: "count", before: b.quotesSent, now: n.quotesSent, better: "up", definition: `Quotes sent to customers in each window, created at least ${MATURE_DAYS} days before its end.` });
  if (b.quotesSent >= 10 && n.quotesSent >= 10)
    add({ key: "acceptance", label: "Quote acceptance", unit: "pct", before: b.quotesAccepted / b.quotesSent, now: n.quotesAccepted / n.quotesSent, better: "up", definition: `Accepted ÷ sent, for quotes at least ${MATURE_DAYS} days old in each window.` });
  if (b.acceptedValue >= 5000) add({ key: "wonValue", label: "Quote value won", unit: "money", before: b.acceptedValue, now: n.acceptedValue, better: "up", definition: `Value of accepted quotes, created at least ${MATURE_DAYS} days before the window's end.` });
  if (b.invoices >= 10) add({ key: "invoiced", label: "Invoiced", unit: "money", before: b.invoiced, now: n.invoiced, better: "up", definition: "Non-voided invoice value issued in each window (billing activity, not profit)." });
  if (b.matureInvoiced >= 5000 && n.matureInvoiced >= 5000)
    add({ key: "collection", label: "Invoice value collected", unit: "pct", before: b.matureCollected / b.matureInvoiced, now: n.matureCollected / n.matureInvoiced, better: "up", definition: `Collected ÷ invoiced, for invoices at least ${MATURE_DAYS} days old in each window.` });
  const bd = median(b.daysToPay);
  const nd = median(n.daysToPay);
  if (bd != null && nd != null && b.daysToPay.length >= 10 && n.daysToPay.length >= 10)
    add({ key: "daysToPay", label: "Days to get paid", unit: "days", before: bd, now: nd, better: "down", definition: "Median days from invoice date to paid date, for settled invoices in each window." });
  if (b.payments >= 5000 && n.payments > 0)
    add({ key: "online", label: "Payments collected online", unit: "pct", before: b.paymentsOnline / b.payments, now: n.paymentsOnline / n.payments, better: "up", definition: "Share of payment value with payment mode type ONLINE." });

  // ---- Adoption: Zuper capabilities with real activity in each window ---------------------------
  const catalogLabel = new Map(CATALOG.map((c) => [c.key, c.label]));
  const capabilities = (w: DateRange, s: WindowStats): string[] => {
    const out: string[] = [];
    if (s.jobsCreated >= ADOPTION_MIN) out.push("Jobs & dispatch");
    if (s.recurring >= ADOPTION_MIN) out.push("Recurring jobs");
    if (s.quotesSent >= ADOPTION_MIN) out.push("Quotes");
    if (s.invoices >= ADOPTION_MIN) out.push("Invoicing");
    if (payments.filter((p) => inWin(p.paidAt, w) && p.paymentModeType === "ONLINE").length >= ADOPTION_MIN) out.push("Online payments");
    if (workflows.filter((wf) => wf.createdAt <= w.end).length >= 1) out.push("Workflow automation");
    const byModule = new Map<string, number>();
    for (const r of records) if (inWin(r.recordCreatedAt, w)) byModule.set(r.module, (byModule.get(r.module) ?? 0) + 1);
    for (const [mod, count] of byModule) if (count >= ADOPTION_MIN && catalogLabel.has(mod)) out.push(catalogLabel.get(mod)!);
    return [...new Set(out)];
  };
  const before = capabilities(previous, b);
  const now = capabilities(current, n);
  const adoption = { before, now, added: now.filter((c) => !before.includes(c)), dropped: before.filter((c) => !now.includes(c)) };

  // ---- Call-outs -----------------------------------------------------------------------------
  const callouts: Callout[] = [];
  for (const m of metrics) {
    if (!m.material) continue;
    const head = `${m.label} ${m.improved ? (m.better === "up" ? "up" : "down") : m.better === "up" ? "down" : "up"} ${formatYoyChange(m).replace(/^[+−]/, "")} vs last year`;
    const detail = `${formatYoyValue(m, m.now)} this period vs ${formatYoyValue(m, m.before)} in the same period last year`;
    const weight = m.unit === "pct" ? Math.abs(m.change) * 300 : Math.min(Math.abs(m.change), 2) * 40;
    callouts.push({ tone: m.improved ? "win" : "watch", area: "Year over year", headline: head, detail, score: Math.round(45 + Math.min(weight, 40)) });
  }
  if (adoption.added.length) {
    callouts.push({
      tone: "win",
      area: "Adoption",
      headline: `${adoption.now.length} Zuper capabilities in use, up from ${adoption.before.length} a year ago`,
      detail: `newly in use: ${adoption.added.slice(0, 4).join(", ")}`,
      score: 85,
    });
  }
  if (adoption.dropped.length) {
    callouts.push({ tone: "watch", area: "Adoption", headline: `${adoption.dropped.length} capabilities used last year show no activity now`, detail: `no longer active: ${adoption.dropped.slice(0, 4).join(", ")}`, score: 60 });
  }

  return { eligible: true, reason: null, current, previous, metrics, adoption, callouts };
}
