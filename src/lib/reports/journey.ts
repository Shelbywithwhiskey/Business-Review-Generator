import { prisma } from "@/lib/db";
import type { DateRange } from "@/lib/zuper/modules";
import { classifyInvoice, classifyQuote, isSentQuote } from "./classify";

// ---------------------------------------------------------------------------
// "Your journey with Zuper": how the account's operation looks in its first
// months on Zuper vs now, from its own records. Deterministic. Per SPEC §14:
// - this is an observed change since adoption, not proof Zuper caused it;
// - cohort metrics that need time to mature (quote decisions, collections)
//   only use months at least 45 days old, so recent, still-open months aren't
//   compared with settled ones;
// - a metric is only compared when both windows have enough volume.
// ---------------------------------------------------------------------------

const DAY = 864e5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MATURE_DAYS = 45;

export interface JourneyMonth {
  key: string;
  label: string;
  start: Date;
  end: Date;
  jobsCreated: number;
  jobsCompleted: number;
  quotesCreated: number;
  quotesSent: number;
  quotesAccepted: number;
  invoices: number;
  invoiced: number;
  paidWithin30: number;
  paymentsTotal: number;
  paymentsOnline: number;
  cycleDays: number[];
  daysToPay: number[];
  customersAdded: number;
  mature: boolean;
}

export interface JourneyMetric {
  key: string;
  label: string;
  unit: "count" | "money" | "pct" | "days";
  early: number;
  now: number;
  /** Which direction is good. */
  better: "up" | "down";
  /** (now − early) ÷ early for counts/money/days; percentage-point difference for pct. */
  change: number;
  improved: boolean;
  earlyLabel: string;
  nowLabel: string;
  definition: string;
}

export interface Milestone {
  date: Date;
  label: string;
}

export interface Journey {
  goLive: Date | null;
  monthsOnZuper: number;
  months: JourneyMonth[];
  metrics: JourneyMetric[];
  milestones: Milestone[];
  totals: { jobs: number; completed: number; quotes: number; quoteValue: number; invoiced: number; collected: number; customersAdded: number };
  /** Whether quoting / invoicing are genuinely run in Zuper (≥10 records and ≥$5K) — test records don't count. */
  uses: { quotes: boolean; invoices: boolean };
  /** Why the then-vs-now comparison is limited, if it is. */
  limitation: string | null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

export async function computeJourney(customerId: string, range: DateRange): Promise<Journey> {
  const endAt = range.end;
  const [jobs, quotes, invoices, payments, firstWorkflow, firstCall, firstProposal, firstProject, customersAdded, firstOnline] = await Promise.all([
    prisma.job.findMany({ where: { customerId, createdAt: { lte: endAt } }, select: { createdAt: true, completedAt: true, status: true } }),
    prisma.quote.findMany({ where: { customerId, estimateAt: { lte: endAt } }, select: { estimateAt: true, status: true, isConverted: true, isExpired: true, value: true } }),
    prisma.invoice.findMany({ where: { customerId, issuedAt: { lte: endAt } }, select: { issuedAt: true, paidAt: true, amount: true, amountPaid: true, isPaid: true, status: true } }),
    prisma.payment.findMany({ where: { customerId, paidAt: { lte: endAt } }, select: { paidAt: true, amount: true, paymentModeType: true } }),
    prisma.workflow.aggregate({ where: { customerId }, _min: { createdAt: true } }),
    prisma.zuperRecord.aggregate({ where: { customerId, module: "connect_calls" }, _min: { recordCreatedAt: true } }),
    prisma.zuperRecord.aggregate({ where: { customerId, module: "proposals" }, _min: { recordCreatedAt: true } }),
    prisma.project.aggregate({ where: { customerId }, _min: { createdAt: true } }),
    prisma.endCustomerLedger.findMany({ where: { customerId, createdInZuperAt: { lte: endAt } }, select: { createdInZuperAt: true } }),
    prisma.payment.aggregate({ where: { customerId, paymentModeType: "ONLINE" }, _min: { paidAt: true } }),
  ]);

  const firstJob = jobs.reduce<Date | null>((m, j) => (!m || j.createdAt < m ? j.createdAt : m), null);
  const firstQuote = quotes.reduce<Date | null>((m, q) => (!m || q.estimateAt < m ? q.estimateAt : m), null);
  const firstInvoice = invoices.reduce<Date | null>((m, i) => (!m || i.issuedAt < m ? i.issuedAt : m), null);
  const goLive = [firstJob, firstQuote, firstInvoice].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const empty = { goLive, monthsOnZuper: 0, months: [], metrics: [], milestones: [], totals: { jobs: 0, completed: 0, quotes: 0, quoteValue: 0, invoiced: 0, collected: 0, customersAdded: customersAdded.length }, uses: { quotes: false, invoices: false }, limitation: "No activity recorded yet." };
  if (!goLive) return empty;

  // Month buckets from go-live to the report end.
  const months: JourneyMonth[] = [];
  let cur = new Date(Date.UTC(goLive.getUTCFullYear(), goLive.getUTCMonth(), 1));
  while (cur <= endAt) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    months.push({
      key: monthKey(cur),
      label: `${MONTHS[cur.getUTCMonth()]} ${String(cur.getUTCFullYear()).slice(2)}`,
      start: cur,
      end: next,
      jobsCreated: 0,
      jobsCompleted: 0,
      quotesCreated: 0,
      quotesSent: 0,
      quotesAccepted: 0,
      invoices: 0,
      invoiced: 0,
      paidWithin30: 0,
      paymentsTotal: 0,
      paymentsOnline: 0,
      cycleDays: [],
      daysToPay: [],
      customersAdded: 0,
      mature: next.getTime() <= endAt.getTime() - MATURE_DAYS * DAY,
    });
    cur = next;
  }
  const idx = new Map(months.map((m, i) => [m.key, i]));
  const at = (d: Date | null | undefined) => (d ? months[idx.get(monthKey(d)) ?? -1] : undefined);

  for (const j of jobs) {
    const m = at(j.createdAt);
    if (m) m.jobsCreated += 1;
    if (j.status === "completed" && j.completedAt) {
      const c = at(j.completedAt);
      if (c && j.completedAt <= endAt) {
        c.jobsCompleted += 1;
        const days = (j.completedAt.getTime() - j.createdAt.getTime()) / DAY;
        if (days >= 0) c.cycleDays.push(days);
      }
    }
  }
  let quoteValue = 0;
  for (const q of quotes) {
    const m = at(q.estimateAt);
    quoteValue += Number(q.value);
    if (!m) continue;
    m.quotesCreated += 1;
    const o = classifyQuote(q);
    if (isSentQuote(o)) m.quotesSent += 1;
    if (o === "accepted") m.quotesAccepted += 1;
  }
  let invoiced = 0;
  let collected = 0;
  for (const inv of invoices) {
    const amount = Number(inv.amount);
    const paid = Number(inv.amountPaid);
    if (classifyInvoice({ status: inv.status, amount, amountPaid: paid, isPaid: inv.isPaid }) === "void") continue;
    invoiced += amount;
    collected += Math.min(paid, amount);
    const m = at(inv.issuedAt);
    if (!m) continue;
    m.invoices += 1;
    m.invoiced += amount;
    if (inv.paidAt) {
      const d = (inv.paidAt.getTime() - inv.issuedAt.getTime()) / DAY;
      if (d >= 0) m.daysToPay.push(d);
      if (d >= 0 && d <= 30) m.paidWithin30 += Math.min(paid, amount);
    }
  }
  for (const c of customersAdded) {
    const m = at(c.createdInZuperAt);
    if (m) m.customersAdded += 1;
  }
  for (const p of payments) {
    const m = at(p.paidAt);
    if (!m) continue;
    m.paymentsTotal += Number(p.amount);
    if (p.paymentModeType === "ONLINE") m.paymentsOnline += Number(p.amount);
  }

  // ---- Then vs now ---------------------------------------------------------------------------
  // "Early" = first 3 full months after the go-live month (the go-live month itself is onboarding).
  const full = months.filter((m) => m.end <= endAt || m.end.getTime() - endAt.getTime() < DAY);
  const early = full.slice(1, 4);
  const recent = full.slice(-3);
  const matureMonths = full.filter((m) => m.mature);
  const earlyMature = early.filter((m) => m.mature);
  const recentMature = matureMonths.slice(-3);
  const monthsOnZuper = Math.max(0, months.length - 1);
  const win = (ms: JourneyMonth[]) => (ms.length ? `${ms[0].label}–${ms[ms.length - 1].label}` : "—");
  const sum = (ms: JourneyMonth[], f: (m: JourneyMonth) => number) => ms.reduce((s, m) => s + f(m), 0);
  const overlaps = (a: JourneyMonth[], b: JourneyMonth[]) => a.some((m) => b.includes(m));

  const metrics: JourneyMetric[] = [];
  const add = (m: Omit<JourneyMetric, "change" | "improved">) => {
    const change = m.unit === "pct" ? m.now - m.early : m.early ? (m.now - m.early) / m.early : 0;
    const improved = m.better === "up" ? m.now > m.early : m.now < m.early;
    metrics.push({ ...m, change, improved });
  };

  const comparable = early.length === 3 && recent.length === 3 && !overlaps(early, recent);
  if (comparable) {
    const ej = sum(early, (m) => m.jobsCreated) / 3;
    const rj = sum(recent, (m) => m.jobsCreated) / 3;
    if (ej >= 5) add({ key: "jobs", label: "Jobs created per month", unit: "count", early: ej, now: rj, better: "up", earlyLabel: win(early), nowLabel: win(recent), definition: "Average jobs created per month in each 3-month window." });
    const ec = sum(early, (m) => m.jobsCompleted) / 3;
    const rc = sum(recent, (m) => m.jobsCompleted) / 3;
    if (ec >= 5) add({ key: "completed", label: "Jobs completed per month", unit: "count", early: ec, now: rc, better: "up", earlyLabel: win(early), nowLabel: win(recent), definition: "Average jobs reaching Completed/Closed per month." });
    // Close-out discipline: how much of the work created gets completed in Zuper. Catches accounts that
    // started out only creating jobs and now run them end-to-end in Zuper.
    if (sum(early, (m) => m.jobsCreated) >= 15 && sum(recent, (m) => m.jobsCreated) >= 15)
      add({ key: "closeout", label: "Jobs closed out in Zuper", unit: "pct", early: sum(early, (m) => m.jobsCompleted) / sum(early, (m) => m.jobsCreated), now: Math.min(1, sum(recent, (m) => m.jobsCompleted) / sum(recent, (m) => m.jobsCreated)), better: "up", earlyLabel: win(early), nowLabel: win(recent), definition: "Jobs completed in the window ÷ jobs created in the window — how fully work is run end-to-end in Zuper." });
    const ecu = sum(early, (m) => m.customersAdded) / 3;
    const rcu = sum(recent, (m) => m.customersAdded) / 3;
    if (ecu >= 3) add({ key: "customers", label: "New customers per month", unit: "count", early: ecu, now: rcu, better: "up", earlyLabel: win(early), nowLabel: win(recent), definition: "Average end customers created in Zuper per month." });
    const ecy = median(early.flatMap((m) => m.cycleDays));
    const rcy = median(recent.flatMap((m) => m.cycleDays));
    if (ecy != null && rcy != null && early.flatMap((m) => m.cycleDays).length >= 10 && recent.flatMap((m) => m.cycleDays).length >= 10)
      add({ key: "cycle", label: "Days from job created to completed", unit: "days", early: ecy, now: rcy, better: "down", earlyLabel: win(early), nowLabel: win(recent), definition: "Median days from creation to completion for jobs completed in each window." });
    const eq = sum(early, (m) => m.quotesCreated) / 3;
    const rq = sum(recent, (m) => m.quotesCreated) / 3;
    if (eq >= 5) add({ key: "quotes", label: "Quotes created per month", unit: "count", early: eq, now: rq, better: "up", earlyLabel: win(early), nowLabel: win(recent), definition: "Average quotes created per month." });
    const ei = sum(early, (m) => m.invoiced) / 3;
    const ri = sum(recent, (m) => m.invoiced) / 3;
    if (sum(early, (m) => m.invoices) >= 10) add({ key: "invoiced", label: "Invoiced per month", unit: "money", early: ei, now: ri, better: "up", earlyLabel: win(early), nowLabel: win(recent), definition: "Average non-voided invoice value issued per month (billing activity, not profit)." });
    const eon = sum(early, (m) => m.paymentsTotal);
    const ron = sum(recent, (m) => m.paymentsTotal);
    if (eon > 0 && ron > 0 && sum(early, (m) => m.paymentsTotal) >= 5000)
      add({ key: "online", label: "Payments collected online", unit: "pct", early: sum(early, (m) => m.paymentsOnline) / eon, now: sum(recent, (m) => m.paymentsOnline) / ron, better: "up", earlyLabel: win(early), nowLabel: win(recent), definition: "Share of payment value with payment mode type ONLINE." });
  }
  // Maturity-sensitive cohort metrics use only settled months.
  if (earlyMature.length >= 2 && recentMature.length >= 2 && !overlaps(earlyMature, recentMature)) {
    const es = sum(earlyMature, (m) => m.quotesSent);
    const rs = sum(recentMature, (m) => m.quotesSent);
    if (es >= 10 && rs >= 10)
      add({ key: "acceptance", label: "Quote acceptance", unit: "pct", early: sum(earlyMature, (m) => m.quotesAccepted) / es, now: sum(recentMature, (m) => m.quotesAccepted) / rs, better: "up", earlyLabel: win(earlyMature), nowLabel: win(recentMature), definition: `Accepted ÷ sent quotes, only for months at least ${MATURE_DAYS} days old so quotes have had time to be decided.` });
    const ev = sum(earlyMature, (m) => m.invoiced);
    const rv = sum(recentMature, (m) => m.invoiced);
    if (sum(earlyMature, (m) => m.invoices) >= 10 && sum(recentMature, (m) => m.invoices) >= 10)
      add({ key: "paid30", label: "Invoice value paid within 30 days", unit: "pct", early: sum(earlyMature, (m) => m.paidWithin30) / ev, now: sum(recentMature, (m) => m.paidWithin30) / rv, better: "up", earlyLabel: win(earlyMature), nowLabel: win(recentMature), definition: `Value paid within 30 days of the invoice date ÷ value invoiced, for invoice months at least ${MATURE_DAYS} days old.` });
    const ed = median(earlyMature.flatMap((m) => m.daysToPay));
    const rd = median(recentMature.flatMap((m) => m.daysToPay));
    if (ed != null && rd != null && earlyMature.flatMap((m) => m.daysToPay).length >= 10 && recentMature.flatMap((m) => m.daysToPay).length >= 10)
      add({ key: "daysToPay", label: "Days to get paid", unit: "days", early: ed, now: rd, better: "down", earlyLabel: win(earlyMature), nowLabel: win(recentMature), definition: "Median days from invoice date to paid date, for paid invoices in each window." });
  }

  const milestones: Milestone[] = [
    firstJob && { date: firstJob, label: "First job in Zuper" },
    firstQuote && { date: firstQuote, label: "First quote" },
    firstInvoice && { date: firstInvoice, label: "First invoice" },
    firstOnline._min.paidAt && { date: firstOnline._min.paidAt, label: "First online payment" },
    firstWorkflow._min.createdAt && { date: firstWorkflow._min.createdAt, label: "First automation" },
    firstProposal._min.recordCreatedAt && { date: firstProposal._min.recordCreatedAt, label: "First proposal" },
    firstProject._min.createdAt && { date: firstProject._min.createdAt, label: "First project" },
    firstCall._min.recordCreatedAt && { date: firstCall._min.recordCreatedAt, label: "Zuper Connect calls start" },
  ]
    .filter((m): m is Milestone => !!m && m.date <= endAt)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    goLive,
    monthsOnZuper,
    months,
    metrics,
    milestones,
    totals: {
      jobs: jobs.length,
      completed: jobs.filter((j) => j.status === "completed").length,
      quotes: quotes.length,
      quoteValue,
      invoiced,
      collected,
      customersAdded: customersAdded.length,
    },
    uses: { quotes: quotes.length >= 10 && quoteValue >= 5000, invoices: invoices.length >= 10 && invoiced >= 5000 },
    limitation: !comparable
      ? monthsOnZuper < 7
        ? `Only ${monthsOnZuper} months on Zuper — a then-vs-now comparison needs at least 7, so this shows the trajectory so far.`
        : "Not enough activity in the early months to compare."
      : null,
  };
}
