import { prisma } from "@/lib/db";
import type { DateRange } from "@/lib/zuper/modules";

// ---------------------------------------------------------------------------
// Account-view insights for three deck pages: Customers & Revenue, Team
// Productivity, and Speed & Efficiency. Everything is computed from synced rows
// for the review period (and, for Speed, the equally long period before it).
// Each result says whether it has enough data to be worth a slide.
// ---------------------------------------------------------------------------

const DAY_MS = 864e5;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function inRange(d: Date | null | undefined, r: DateRange): boolean {
  return !!d && d >= r.start && d <= r.end;
}

/** The window of the same length immediately before `range`. */
export function priorRange(range: DateRange): DateRange {
  const len = range.end.getTime() - range.start.getTime();
  return { start: new Date(range.start.getTime() - len - 1), end: new Date(range.start.getTime() - 1) };
}

// ---- Customers & revenue ----------------------------------------------------

export interface CustomerRevenue {
  hasData: boolean;
  /** Distinct end customers with at least one job created in the period. */
  customersServed: number;
  /** Of those, how many had 2+ jobs in the period. */
  repeatInPeriod: number;
  /** Of those, how many were created in Zuper during the period. */
  newServed: number;
  /** Sum of job value for non-cancelled jobs created in the period that are linked to a customer. */
  periodValue: number;
  /** True when job values are recorded; otherwise customers are ranked by job count. */
  valued: boolean;
  topCustomers: { name: string; jobs: number; value: number }[];
  /** Share of period value (or jobs when unvalued) from the top 5 customers. */
  top5Share: number;
  topCustomer: { name: string; share: number } | null;
  receivables: { name: string; amount: number }[];
  totalReceivables: number;
  /** Top-10 lifetime-value customers with no job in the period. */
  quietHighValue: { name: string; ltv: number; lifetimeJobs: number }[];
}

export async function computeCustomerRevenue(customerId: string, range: DateRange): Promise<CustomerRevenue> {
  const [jobs, ledger] = await Promise.all([
    prisma.job.findMany({
      where: { customerId, createdAt: { gte: range.start, lte: range.end }, endCustomerId: { not: null }, status: { not: "cancelled" } },
      select: { endCustomerId: true, jobValue: true },
    }),
    prisma.endCustomerLedger.findMany({ where: { customerId }, select: { zuperCustomerId: true, name: true, ltv: true, receivables: true, noOfJobs: true, createdInZuperAt: true } }),
  ]);
  const byId = new Map(ledger.map((c) => [c.zuperCustomerId, c]));

  const per = new Map<string, { jobs: number; value: number }>();
  for (const j of jobs) {
    const e = per.get(j.endCustomerId!) ?? { jobs: 0, value: 0 };
    e.jobs += 1;
    e.value += j.jobValue ? Number(j.jobValue) : 0;
    per.set(j.endCustomerId!, e);
  }
  const periodValue = [...per.values()].reduce((s, e) => s + e.value, 0);
  const valued = periodValue > 0;
  const measure = (e: { jobs: number; value: number }) => (valued ? e.value : e.jobs);
  const ranked = [...per.entries()]
    .map(([id, e]) => ({ id, name: byId.get(id)?.name ?? "Unnamed customer", ...e }))
    .sort((a, b) => measure(b) - measure(a));
  const total = ranked.reduce((s, e) => s + measure(e), 0);
  const top5 = ranked.slice(0, 5).reduce((s, e) => s + measure(e), 0);

  const servedIds = new Set(per.keys());
  const byLtv = [...ledger].sort((a, b) => Number(b.ltv) - Number(a.ltv)).filter((c) => Number(c.ltv) > 0);
  const receivables = ledger
    .filter((c) => Number(c.receivables) > 0)
    .sort((a, b) => Number(b.receivables) - Number(a.receivables))
    .map((c) => ({ name: c.name, amount: Number(c.receivables) }));

  return {
    hasData: ranked.length >= 3,
    customersServed: ranked.length,
    repeatInPeriod: ranked.filter((e) => e.jobs >= 2).length,
    newServed: ranked.filter((e) => inRange(byId.get(e.id)?.createdInZuperAt, range)).length,
    periodValue,
    valued,
    topCustomers: ranked.slice(0, 8).map(({ name, jobs, value }) => ({ name, jobs, value })),
    top5Share: total ? top5 / total : 0,
    topCustomer: ranked[0] && total ? { name: ranked[0].name, share: measure(ranked[0]) / total } : null,
    receivables: receivables.slice(0, 5),
    totalReceivables: receivables.reduce((s, c) => s + c.amount, 0),
    quietHighValue: byLtv
      .slice(0, 10)
      .filter((c) => !servedIds.has(c.zuperCustomerId) && c.noOfJobs > 0)
      .map((c) => ({ name: c.name, ltv: Number(c.ltv), lifetimeJobs: c.noOfJobs })),
  };
}

// ---- Team productivity ------------------------------------------------------

export interface TechProductivity {
  name: string;
  assigned: number;
  completed: number;
  /** Job value of completed jobs. */
  revenue: number;
  /** Clocked hours from paired timesheet events in the period. */
  hours: number;
}

export interface TeamProductivity {
  hasData: boolean;
  people: TechProductivity[];
  totalCompleted: number;
  totalRevenue: number;
  totalHours: number;
  /** Active users with no login since the period started (or never). */
  dormantSeats: { name: string; licenseType: string | null; lastLoginAt: Date | null }[];
  activeUsers: number;
}

export async function computeTeamProductivity(customerId: string, range: DateRange): Promise<TeamProductivity> {
  const [jobs, techRows, events] = await Promise.all([
    prisma.job.findMany({ where: { customerId, createdAt: { gte: range.start, lte: range.end }, technicianId: { not: null } }, select: { technicianId: true, status: true, jobValue: true } }),
    prisma.technician.findMany({ where: { customerId }, orderBy: { periodEnd: "desc" }, select: { zuperUserId: true, name: true, isActive: true, lastLoginAt: true, licenseType: true, designation: true } }),
    prisma.timesheetEvent.findMany({ where: { customerId, checkedAt: { gte: range.start, lte: range.end } }, orderBy: { checkedAt: "asc" }, select: { zuperUserId: true, typeOfCheck: true, checkedAt: true } }),
  ]);
  // Technician rows are stored per sync period; the most recent row per user is their identity.
  const people = new Map<string, (typeof techRows)[number]>();
  for (const t of techRows) if (!people.has(t.zuperUserId)) people.set(t.zuperUserId, t);

  const per = new Map<string, TechProductivity>();
  const get = (uid: string) => {
    let e = per.get(uid);
    if (!e) per.set(uid, (e = { name: people.get(uid)?.name ?? "Unknown user", assigned: 0, completed: 0, revenue: 0, hours: 0 }));
    return e;
  };
  for (const j of jobs) {
    const e = get(j.technicianId!);
    e.assigned += 1;
    if (j.status === "completed") {
      e.completed += 1;
      e.revenue += j.jobValue ? Number(j.jobValue) : 0;
    }
  }
  // Pair CHECK_IN → CHECK_OUT per user (same rule as analytics.computeTimesheetHours).
  const openIn = new Map<string, Date>();
  for (const ev of events) {
    if (ev.typeOfCheck === "CHECK_IN") openIn.set(ev.zuperUserId, ev.checkedAt);
    else if (ev.typeOfCheck === "CHECK_OUT" && openIn.has(ev.zuperUserId)) {
      const hours = (ev.checkedAt.getTime() - openIn.get(ev.zuperUserId)!.getTime()) / 36e5;
      if (hours > 0 && hours < 24) get(ev.zuperUserId).hours += hours;
      openIn.delete(ev.zuperUserId);
    }
  }

  const list = [...per.values()].filter((p) => p.assigned > 0 || p.hours > 0).sort((a, b) => b.revenue - a.revenue || b.completed - a.completed);
  const active = [...people.values()].filter((p) => p.isActive);
  return {
    hasData: list.filter((p) => p.assigned > 0).length >= 2,
    people: list,
    totalCompleted: list.reduce((s, p) => s + p.completed, 0),
    totalRevenue: list.reduce((s, p) => s + p.revenue, 0),
    totalHours: list.reduce((s, p) => s + p.hours, 0),
    dormantSeats: active
      .filter((p) => !p.lastLoginAt || p.lastLoginAt < range.start)
      .map((p) => ({ name: p.name, licenseType: p.licenseType, lastLoginAt: p.lastLoginAt })),
    activeUsers: active.length,
  };
}

// ---- Speed & efficiency -----------------------------------------------------

export interface SpeedMetric {
  key: "job_to_scheduled" | "scheduled_to_done" | "job_to_done" | "quote_to_sent" | "quote_to_accepted" | "invoice_to_paid";
  label: string;
  /** Median in days; null when fewer than MIN_SAMPLE observations. */
  now: number | null;
  before: number | null;
  nowSample: number;
  beforeSample: number;
}

export interface SpeedEfficiency {
  hasData: boolean;
  metrics: SpeedMetric[];
  prior: DateRange;
}

const MIN_SAMPLE = 5;

interface StatusEntry {
  type?: string;
  at?: string;
}

/** When the job first reached a scheduled-or-later status, from Zuper's status history. */
function firstScheduledAt(history: unknown): Date | null {
  if (!Array.isArray(history)) return null;
  const later = new Set(["SCHEDULED", "STARTED", "COMPLETED", "CLOSED"]);
  const hit = (history as StatusEntry[]).filter((h) => h?.at && later.has(String(h.type ?? "").toUpperCase())).map((h) => new Date(h.at!).getTime()).filter((t) => !Number.isNaN(t));
  return hit.length ? new Date(Math.min(...hit)) : null;
}

export async function computeSpeedEfficiency(customerId: string, range: DateRange): Promise<SpeedEfficiency> {
  const prior = priorRange(range);
  const span = { gte: prior.start, lte: range.end };
  const [jobs, quotes, invoices] = await Promise.all([
    prisma.job.findMany({ where: { customerId, createdAt: span, status: { not: "cancelled" } }, select: { createdAt: true, completedAt: true, statusHistory: true } }),
    prisma.quote.findMany({ where: { customerId, OR: [{ sentAt: span }, { acceptedAt: span }, { convertedAt: span }] }, select: { estimateAt: true, sentAt: true, acceptedAt: true, convertedAt: true } }),
    prisma.invoice.findMany({ where: { customerId, paidAt: span }, select: { issuedAt: true, paidAt: true } }),
  ]);

  const days = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY_MS;
  // Each observation is dated by when its clock stopped, so a window holds work that finished in it.
  const obs: Record<SpeedMetric["key"], { at: Date; d: number }[]> = {
    job_to_scheduled: [],
    scheduled_to_done: [],
    job_to_done: [],
    quote_to_sent: [],
    quote_to_accepted: [],
    invoice_to_paid: [],
  };
  const push = (k: SpeedMetric["key"], start: Date | null, end: Date | null) => {
    if (!start || !end) return;
    const d = days(start, end);
    if (d >= 0 && d < 730) obs[k].push({ at: end, d });
  };
  for (const j of jobs) {
    const sched = firstScheduledAt(j.statusHistory);
    push("job_to_scheduled", j.createdAt, sched);
    push("scheduled_to_done", sched, j.completedAt);
    push("job_to_done", j.createdAt, j.completedAt);
  }
  for (const q of quotes) {
    push("quote_to_sent", q.estimateAt, q.sentAt);
    push("quote_to_accepted", q.sentAt ?? q.estimateAt, q.acceptedAt ?? q.convertedAt);
  }
  for (const i of invoices) push("invoice_to_paid", i.issuedAt, i.paidAt);

  const LABELS: Record<SpeedMetric["key"], string> = {
    job_to_scheduled: "Job created → scheduled",
    scheduled_to_done: "Scheduled → completed",
    job_to_done: "Job created → completed",
    quote_to_sent: "Quote drafted → sent",
    quote_to_accepted: "Quote sent → accepted",
    invoice_to_paid: "Invoice issued → paid",
  };
  const metrics = (Object.keys(obs) as SpeedMetric["key"][]).map((key) => {
    const now = obs[key].filter((o) => inRange(o.at, range)).map((o) => o.d);
    const before = obs[key].filter((o) => inRange(o.at, prior)).map((o) => o.d);
    return {
      key,
      label: LABELS[key],
      now: now.length >= MIN_SAMPLE ? median(now) : null,
      before: before.length >= MIN_SAMPLE ? median(before) : null,
      nowSample: now.length,
      beforeSample: before.length,
    };
  });
  const shown = metrics.filter((m) => m.now != null);
  return { hasData: shown.length >= 2, metrics: shown, prior };
}
