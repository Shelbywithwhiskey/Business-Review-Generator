import { prisma } from "@/lib/db";
import type { DateRange, JobStatusEntry } from "@/lib/zuper/modules";
import { classifyInvoice, classifyQuote, isSentQuote } from "./classify";

// ---------------------------------------------------------------------------
// Per-module deep-dive metrics for the generated EBR/QBR slides. Deterministic —
// every number is counted from synced rows (same rule as lib/analytics.ts).
// Each result carries the record count it was computed from so slides can say
// exactly what they cover.
// ---------------------------------------------------------------------------

const DAY_MS = 864e5;
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function inRange(d: Date | null | undefined, range: DateRange): boolean {
  return !!d && d >= range.start && d <= range.end;
}

/** Calendar months overlapping the range (capped to the most recent `max`). */
function monthBuckets(range: DateRange, max = 12): { label: string; start: Date; end: Date }[] {
  const out = [];
  let cur = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), 1));
  while (cur <= range.end) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    out.push({ label: `${MONTH_ABBR[cur.getUTCMonth()]} ${String(cur.getUTCFullYear()).slice(2)}`, start: cur, end: next });
    cur = next;
  }
  return out.slice(-max);
}

// ---- Report scope ----------------------------------------------------------

export interface SyncInfo {
  completedAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  notes: string | null;
  /** True when the report period isn't fully inside the last successful sync's period. */
  periodOutsideSync: boolean;
}

export async function computeSyncInfo(customerId: string, range: DateRange): Promise<SyncInfo> {
  const run = await prisma.syncRun.findFirst({ where: { customerId, status: "SUCCESS" }, orderBy: { completedAt: "desc" } });
  return {
    completedAt: run?.completedAt ?? null,
    periodStart: run?.periodStart ?? null,
    periodEnd: run?.periodEnd ?? null,
    notes: run?.errorMessage ?? null,
    periodOutsideSync: !run || run.periodStart > range.start || run.periodEnd < range.end,
  };
}

/** Earliest record per module in the synced data — lists pull full history, so these are the
 * account's first recorded use of each area of Zuper (unless records were deleted or imported). */
export interface AccountActivityDates {
  firstJob: Date | null;
  firstQuote: Date | null;
  firstInvoice: Date | null;
  firstPayment: Date | null;
  firstWorkflow: Date | null;
  firstEndCustomer: Date | null;
}

export async function computeAccountActivityDates(customerId: string): Promise<AccountActivityDates> {
  const [job, quote, invoice, payment, workflow, endCustomer] = await Promise.all([
    prisma.job.aggregate({ where: { customerId }, _min: { createdAt: true } }),
    prisma.quote.aggregate({ where: { customerId }, _min: { estimateAt: true } }),
    prisma.invoice.aggregate({ where: { customerId }, _min: { issuedAt: true } }),
    prisma.payment.aggregate({ where: { customerId }, _min: { paidAt: true } }),
    prisma.workflow.aggregate({ where: { customerId }, _min: { createdAt: true } }),
    prisma.endCustomerLedger.aggregate({ where: { customerId }, _min: { createdInZuperAt: true } }),
  ]);
  return {
    firstJob: job._min.createdAt,
    firstQuote: quote._min.estimateAt,
    firstInvoice: invoice._min.issuedAt,
    firstPayment: payment._min.paidAt,
    firstWorkflow: workflow._min.createdAt,
    firstEndCustomer: endCustomer._min.createdInZuperAt,
  };
}

export interface ScopeRow {
  module: string;
  inPeriod: string;
  basis: string;
  note: string;
}

// ---- Jobs ------------------------------------------------------------------

export interface JobDeepDive {
  created: number;
  completed: number;
  cancelled: number;
  completionRate: number;
  recurringShare: number;
  unscheduledOpen: number;
  highPriority: number;
  /** Jobs created in the period that were scheduled (flagged scheduled, or reached a Scheduled status). */
  scheduled: number;
  monthly: { label: string; created: number; completed: number }[];
  categories: { name: string; created: number; completed: number }[];
  /** Hours from job creation to first SCHEDULED status (jobs that were scheduled). */
  medianHoursToSchedule: number | null;
  /** Hours from first SCHEDULED to first COMPLETED status. */
  medianHoursScheduledToComplete: number | null;
  medianDaysCreatedToComplete: number | null;
  lifecycleSample: number;
  /** Jobs created in the period that are still open, grouped by their current status. */
  openByStatus: { name: string; count: number; medianAgeDays: number | null }[];
  /** Average hours jobs spent in each status (Zuper's time_on_status), heaviest first. */
  timeInStatus: { name: string; avgHours: number; jobs: number }[];
  /** Statuses ranked by total job-days spent in them (avg × jobs) — where the time actually goes. */
  statusLoad: { name: string; jobDays: number; avgDays: number; jobs: number }[];
}

export async function computeJobDeepDive(customerId: string, range: DateRange): Promise<JobDeepDive> {
  const [jobs, completedInMonths] = await Promise.all([
    prisma.job.findMany({
      where: { customerId, createdAt: { gte: range.start, lte: range.end } },
      select: { status: true, rawStatusName: true, serviceType: true, createdAt: true, completedAt: true, isRecurring: true, isScheduled: true, priority: true, statusHistory: true },
    }),
    prisma.job.findMany({ where: { customerId, completedAt: { gte: range.start, lte: range.end } }, select: { completedAt: true } }),
  ]);

  const months = monthBuckets(range);
  const monthly = months.map((m) => ({
    label: m.label,
    created: jobs.filter((j) => j.createdAt >= m.start && j.createdAt < m.end).length,
    completed: completedInMonths.filter((j) => j.completedAt! >= m.start && j.completedAt! < m.end).length,
  }));

  const cats = new Map<string, { created: number; completed: number }>();
  for (const j of jobs) {
    const c = cats.get(j.serviceType ?? "Uncategorized") ?? { created: 0, completed: 0 };
    c.created += 1;
    if (j.status === "completed") c.completed += 1;
    cats.set(j.serviceType ?? "Uncategorized", c);
  }
  const sortedCats = [...cats.entries()].sort((a, b) => b[1].created - a[1].created);
  const categories = sortedCats.slice(0, 7).map(([name, v]) => ({ name, ...v }));
  if (sortedCats.length > 7) {
    const rest = sortedCats.slice(7).reduce((acc, [, v]) => ({ created: acc.created + v.created, completed: acc.completed + v.completed }), { created: 0, completed: 0 });
    categories.push({ name: `Other (${sortedCats.length - 7})`, ...rest });
  }

  const toSchedule: number[] = [];
  const schedToComplete: number[] = [];
  const createdToComplete: number[] = [];
  const statusTime = new Map<string, { minutes: number; jobs: number }>();
  const open = new Map<string, number[]>();
  const now = Date.now();

  for (const j of jobs) {
    const history = (Array.isArray(j.statusHistory) ? j.statusHistory : []) as unknown as JobStatusEntry[];
    const firstScheduled = history.find((h) => h.type === "SCHEDULED");
    const firstCompleted = history.find((h) => h.type === "COMPLETED");
    if (firstScheduled) toSchedule.push((new Date(firstScheduled.at).getTime() - j.createdAt.getTime()) / 36e5);
    if (firstScheduled && firstCompleted && firstCompleted.at >= firstScheduled.at) {
      schedToComplete.push((new Date(firstCompleted.at).getTime() - new Date(firstScheduled.at).getTime()) / 36e5);
    }
    if (j.completedAt) createdToComplete.push((j.completedAt.getTime() - j.createdAt.getTime()) / DAY_MS);
    // time_on_status is only final for statuses the job has already left — skip the current (last) one.
    history.slice(0, -1).forEach((h) => {
      if (h.minutes == null || h.minutes < 0) return;
      const t = statusTime.get(h.name) ?? { minutes: 0, jobs: 0 };
      t.minutes += h.minutes;
      t.jobs += 1;
      statusTime.set(h.name, t);
    });
    if (j.status !== "completed" && j.status !== "cancelled") {
      const name = j.rawStatusName ?? "Unknown";
      open.set(name, [...(open.get(name) ?? []), (now - j.createdAt.getTime()) / DAY_MS]);
    }
  }

  const completed = jobs.filter((j) => j.status === "completed").length;
  return {
    created: jobs.length,
    completed,
    cancelled: jobs.filter((j) => j.status === "cancelled").length,
    completionRate: jobs.length ? completed / jobs.length : 0,
    recurringShare: jobs.length ? jobs.filter((j) => j.isRecurring).length / jobs.length : 0,
    unscheduledOpen: jobs.filter((j) => !j.isScheduled && j.status !== "completed" && j.status !== "cancelled").length,
    highPriority: jobs.filter((j) => /high|urgent/i.test(j.priority ?? "")).length,
    scheduled: jobs.filter((j) => j.isScheduled || ((Array.isArray(j.statusHistory) ? j.statusHistory : []) as unknown as JobStatusEntry[]).some((h) => h.type === "SCHEDULED")).length,
    monthly,
    categories,
    medianHoursToSchedule: median(toSchedule.filter((h) => h >= 0)),
    medianHoursScheduledToComplete: median(schedToComplete),
    medianDaysCreatedToComplete: median(createdToComplete.filter((d) => d >= 0)),
    lifecycleSample: toSchedule.length,
    openByStatus: [...open.entries()]
      .map(([name, ages]) => ({ name, count: ages.length, medianAgeDays: median(ages) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 7),
    timeInStatus: [...statusTime.entries()]
      .map(([name, t]) => ({ name, avgHours: t.minutes / 60 / t.jobs, jobs: t.jobs }))
      .filter((t) => t.jobs >= Math.min(10, Math.max(3, Math.round(jobs.length * 0.02))))
      .sort((a, b) => b.avgHours - a.avgHours)
      .slice(0, 7),
    statusLoad: [...statusTime.entries()]
      .map(([name, t]) => ({ name, jobDays: t.minutes / 1440, avgDays: t.minutes / 1440 / t.jobs, jobs: t.jobs }))
      .sort((a, b) => b.jobDays - a.jobDays)
      .slice(0, 7),
  };
}

// ---- Customers, organizations, properties ---------------------------------

export interface AccountsDeepDive {
  customers: { total: number; newInPeriod: number; active: number; repeatShare: number };
  organizations: { total: number; newInPeriod: number };
  properties: { total: number; newInPeriod: number };
  /** Organizations ranked by jobs created in the period. */
  topOrganizationsByJobs: { name: string; jobs: number }[];
  jobsWithOrganization: number;
  /** Properties ranked by Zuper's all-time job count. */
  topPropertiesByJobs: { name: string; jobs: number }[];
  propertiesByState: { state: string; count: number }[];
  customerCategories: { name: string; count: number }[];
  topCustomersByLtv: { name: string; ltv: number }[];
  /** New customers per month of the period. */
  customersMonthly: { label: string; count: number }[];
  top5LtvShare: number;
  totalLtv: number;
  totalReceivables: number;
}

export async function computeAccountsDeepDive(customerId: string, range: DateRange): Promise<AccountsDeepDive> {
  const [customers, orgs, properties, jobOrgs] = await Promise.all([
    prisma.endCustomerLedger.findMany({ where: { customerId } }),
    prisma.organization.findMany({ where: { customerId } }),
    prisma.property.findMany({ where: { customerId } }),
    prisma.job.groupBy({
      by: ["organizationUid"],
      where: { customerId, createdAt: { gte: range.start, lte: range.end }, organizationUid: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const orgName = new Map(orgs.map((o) => [o.zuperOrganizationId, o.name]));
  const byLtv = [...customers].sort((a, b) => Number(b.ltv) - Number(a.ltv));
  const totalLtv = customers.reduce((s, c) => s + Number(c.ltv), 0);
  const tally = <T>(items: T[], key: (t: T) => string | null) => {
    const m = new Map<string, number>();
    for (const it of items) {
      const k = key(it);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  return {
    customers: {
      total: customers.length,
      newInPeriod: customers.filter((c) => inRange(c.createdInZuperAt, range)).length,
      active: customers.filter((c) => c.isActive).length,
      repeatShare: customers.length ? customers.filter((c) => c.noOfJobs > 1).length / customers.length : 0,
    },
    organizations: { total: orgs.length, newInPeriod: orgs.filter((o) => inRange(o.createdAt, range)).length },
    properties: { total: properties.length, newInPeriod: properties.filter((p) => inRange(p.createdAt, range)).length },
    topOrganizationsByJobs: jobOrgs
      .map((g) => ({ name: orgName.get(g.organizationUid!) ?? "Unknown organization", jobs: g._count._all }))
      .sort((a, b) => b.jobs - a.jobs)
      .slice(0, 8),
    jobsWithOrganization: jobOrgs.reduce((s, g) => s + g._count._all, 0),
    topPropertiesByJobs: [...properties]
      .sort((a, b) => b.noOfJobs - a.noOfJobs)
      .slice(0, 8)
      .filter((p) => p.noOfJobs > 0)
      .map((p) => ({ name: p.name, jobs: p.noOfJobs })),
    propertiesByState: tally(properties, (p) => p.state).slice(0, 6).map(([state, count]) => ({ state, count })),
    customerCategories: tally(customers, (c) => c.category).slice(0, 5).map(([name, count]) => ({ name, count })),
    topCustomersByLtv: byLtv.slice(0, 6).filter((c) => Number(c.ltv) > 0).map((c) => ({ name: c.name, ltv: Number(c.ltv) })),
    customersMonthly: monthBuckets(range).map((m) => ({
      label: m.label,
      count: customers.filter((c) => c.createdInZuperAt && c.createdInZuperAt >= m.start && c.createdInZuperAt < m.end).length,
    })),
    top5LtvShare: totalLtv ? byLtv.slice(0, 5).reduce((s, c) => s + Number(c.ltv), 0) / totalLtv : 0,
    totalLtv,
    totalReceivables: customers.reduce((s, c) => s + Number(c.receivables), 0),
  };
}

// ---- Workforce & time -------------------------------------------------------

export interface WorkforceDeepDive {
  teamSize: number;
  loggedInThisPeriod: number;
  jobsAssigned: number;
  jobsUnassigned: number;
  /** Jobs completed per technician (primary assignee), created in the period. */
  byTechnician: { name: string; completed: number; assigned: number }[];
  timesheetEvents: number;
  timesheetHours: number;
}

export async function computeWorkforceDeepDive(customerId: string, range: DateRange): Promise<WorkforceDeepDive> {
  const [jobs, techRows, timesheetEvents] = await Promise.all([
    prisma.job.findMany({ where: { customerId, createdAt: { gte: range.start, lte: range.end } }, select: { technicianId: true, status: true } }),
    prisma.technician.findMany({ where: { customerId }, orderBy: { periodEnd: "desc" }, select: { zuperUserId: true, name: true, lastLoginAt: true, isActive: true, hoursWorked: true, periodStart: true, periodEnd: true } }),
    prisma.timesheetEvent.findMany({ where: { customerId, checkedAt: { gte: range.start, lte: range.end } }, orderBy: { checkedAt: "asc" } }),
  ]);

  // Technician rows are stored per sync period; keep the most recent row per user for identity.
  const people = new Map<string, (typeof techRows)[number]>();
  for (const t of techRows) if (!people.has(t.zuperUserId)) people.set(t.zuperUserId, t);

  const perTech = new Map<string, { completed: number; assigned: number }>();
  for (const j of jobs) {
    if (!j.technicianId) continue;
    const t = perTech.get(j.technicianId) ?? { completed: 0, assigned: 0 };
    t.assigned += 1;
    if (j.status === "completed") t.completed += 1;
    perTech.set(j.technicianId, t);
  }

  // Pair CHECK_IN/CHECK_OUT per user chronologically (same rule as analytics.computeTimesheetHours).
  const openIn = new Map<string, Date>();
  let ms = 0;
  for (const e of timesheetEvents) {
    if (e.typeOfCheck === "CHECK_IN") openIn.set(e.zuperUserId, e.checkedAt);
    else if (e.typeOfCheck === "CHECK_OUT" && openIn.has(e.zuperUserId)) {
      ms += e.checkedAt.getTime() - openIn.get(e.zuperUserId)!.getTime();
      openIn.delete(e.zuperUserId);
    }
  }

  const active = [...people.values()].filter((p) => p.isActive);
  return {
    teamSize: active.length,
    loggedInThisPeriod: active.filter((p) => inRange(p.lastLoginAt, range) || (p.lastLoginAt && p.lastLoginAt > range.end)).length,
    jobsAssigned: jobs.filter((j) => j.technicianId).length,
    jobsUnassigned: jobs.filter((j) => !j.technicianId).length,
    byTechnician: [...perTech.entries()]
      .map(([uid, v]) => ({ name: people.get(uid)?.name ?? "Unknown user", ...v }))
      .sort((a, b) => b.completed - a.completed || b.assigned - a.assigned)
      .slice(0, 10),
    timesheetEvents: timesheetEvents.length,
    timesheetHours: ms / 36e5,
  };
}

// ---- Projects ---------------------------------------------------------------

export interface ProjectsDeepDive {
  total: number;
  createdInPeriod: number;
  byStatus: { name: string; count: number }[];
}

export async function computeProjectsDeepDive(customerId: string, range: DateRange): Promise<ProjectsDeepDive> {
  const projects = await prisma.project.findMany({ where: { customerId } });
  const m = new Map<string, number>();
  for (const p of projects.filter((p) => inRange(p.createdAt, range))) m.set(p.status ?? "Unknown", (m.get(p.status ?? "Unknown") ?? 0) + 1);
  return {
    total: projects.length,
    createdInPeriod: projects.filter((p) => inRange(p.createdAt, range)).length,
    byStatus: [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6),
  };
}

// ---- Invoices & collections --------------------------------------------------

export interface InvoiceDeepDive {
  /** Non-voided invoices dated in the period. */
  count: number;
  /** Voided / canceled / archived invoices in the period — excluded from every amount. */
  voided: number;
  invoiced: number;
  collected: number;
  outstanding: number;
  /** Outstanding balance by days past due date (invoices issued in the period). */
  aging: { label: string; amount: number; count: number }[];
  byStatus: { name: string; count: number; amount: number }[];
  medianDaysToPay: number | null;
  paidSample: number;
  paidOnTimeShare: number | null;
  /** Payments received in the period by payment mode. */
  paymentModes: { name: string; amount: number }[];
  paymentsTotal: number;
  onlineShare: number;
}

export async function computeInvoiceDeepDive(customerId: string, range: DateRange): Promise<InvoiceDeepDive> {
  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({ where: { customerId, issuedAt: { gte: range.start, lte: range.end } } }),
    prisma.payment.findMany({ where: { customerId, paidAt: { gte: range.start, lte: range.end } } }),
  ]);
  const now = Date.now();
  const buckets = [
    { label: "Not yet due", test: (d: number) => d <= 0 },
    { label: "1–30 days", test: (d: number) => d > 0 && d <= 30 },
    { label: "31–60 days", test: (d: number) => d > 30 && d <= 60 },
    { label: "61–90 days", test: (d: number) => d > 60 && d <= 90 },
    { label: "90+ days", test: (d: number) => d > 90 },
  ].map((b) => ({ ...b, amount: 0, count: 0 }));
  const status = new Map<string, { count: number; amount: number }>();
  const daysToPay: number[] = [];
  let onTime = 0;
  let withDue = 0;

  const billable = invoices.filter(
    (inv) => classifyInvoice({ status: inv.status, amount: Number(inv.amount), amountPaid: Number(inv.amountPaid), isPaid: inv.isPaid }) !== "void"
  );
  for (const inv of invoices) {
    const amount = Number(inv.amount);
    const isVoid = classifyInvoice({ status: inv.status, amount, amountPaid: Number(inv.amountPaid), isPaid: inv.isPaid }) === "void";
    const s = status.get(inv.status) ?? { count: 0, amount: 0 };
    s.count += 1;
    s.amount += amount;
    status.set(inv.status, s);
    if (isVoid) continue;
    const due = amount - Number(inv.amountPaid);
    if (due > 0.005) {
      const daysPast = inv.dueAt ? (now - inv.dueAt.getTime()) / DAY_MS : 0;
      const b = buckets.find((x) => x.test(daysPast))!;
      b.amount += due;
      b.count += 1;
    }
    if (inv.paidAt) {
      daysToPay.push((inv.paidAt.getTime() - inv.issuedAt.getTime()) / DAY_MS);
      if (inv.dueAt) {
        withDue += 1;
        if (inv.paidAt <= inv.dueAt) onTime += 1;
      }
    }
  }

  const modes = new Map<string, number>();
  let online = 0;
  for (const p of payments) {
    const amount = Number(p.amount);
    modes.set(p.paymentModeName ?? "Unknown", (modes.get(p.paymentModeName ?? "Unknown") ?? 0) + amount);
    if (p.paymentModeType === "ONLINE") online += amount;
  }
  const paymentsTotal = payments.reduce((s, p) => s + Number(p.amount), 0);
  const invoiced = billable.reduce((s, i) => s + Number(i.amount), 0);
  const collected = billable.reduce((s, i) => s + Math.min(Number(i.amountPaid), Number(i.amount)), 0);

  return {
    count: billable.length,
    voided: invoices.length - billable.length,
    invoiced,
    collected,
    outstanding: invoiced - collected,
    aging: buckets.map(({ label, amount, count }) => ({ label, amount, count })),
    byStatus: [...status.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 6),
    medianDaysToPay: median(daysToPay.filter((d) => d >= 0)),
    paidSample: daysToPay.length,
    paidOnTimeShare: withDue ? onTime / withDue : null,
    paymentModes: [...modes.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 6),
    paymentsTotal,
    onlineShare: paymentsTotal ? online / paymentsTotal : 0,
  };
}

// ---- Quotes -----------------------------------------------------------------

export interface QuoteDeepDive {
  count: number;
  /** Quotes that left draft — the conversion-rate denominator. */
  sent: number;
  value: number;
  byStatus: { name: string; count: number; value: number }[];
  convertedCount: number;
  convertedValue: number;
  conversionRate: number;
  medianDaysToAccept: number | null;
  acceptSample: number;
  expiredOpen: number;
  /** Open (sent, undecided) quotes dated more than 30 days before today. */
  staleOpen: { count: number; value: number };
  monthly: { label: string; created: number; converted: number }[];
}

export async function computeQuoteDeepDive(customerId: string, range: DateRange): Promise<QuoteDeepDive> {
  const quotes = await prisma.quote.findMany({ where: { customerId, estimateAt: { gte: range.start, lte: range.end } } });
  const status = new Map<string, { count: number; value: number }>();
  const toAccept: number[] = [];
  for (const q of quotes) {
    const s = status.get(q.status) ?? { count: 0, value: 0 };
    s.count += 1;
    s.value += Number(q.value);
    status.set(q.status, s);
    const accepted = q.acceptedAt ?? q.convertedAt;
    if (accepted) toAccept.push((accepted.getTime() - (q.sentAt ?? q.estimateAt).getTime()) / DAY_MS);
  }
  const outcomes = quotes.map((q) => classifyQuote(q));
  const converted = quotes.filter((_, i) => outcomes[i] === "accepted");
  const sent = outcomes.filter(isSentQuote).length;
  return {
    count: quotes.length,
    sent,
    value: quotes.reduce((s, q) => s + Number(q.value), 0),
    byStatus: [...status.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count),
    convertedCount: converted.length,
    convertedValue: converted.reduce((s, q) => s + Number(q.value), 0),
    conversionRate: sent ? converted.length / sent : 0,
    medianDaysToAccept: median(toAccept.filter((d) => d >= 0)),
    acceptSample: toAccept.length,
    expiredOpen: quotes.filter((q) => q.isExpired && !q.isConverted).length,
    staleOpen: (() => {
      const cutoff = Date.now() - 30 * DAY_MS;
      const stale = quotes.filter((q, i) => outcomes[i] === "open" && (q.sentAt ?? q.estimateAt).getTime() < cutoff);
      return { count: stale.length, value: stale.reduce((s, q) => s + Number(q.value), 0) };
    })(),
    monthly: monthBuckets(range).map((m) => ({
      label: m.label,
      created: quotes.filter((q) => q.estimateAt >= m.start && q.estimateAt < m.end).length,
      converted: converted.filter((q) => q.estimateAt >= m.start && q.estimateAt < m.end).length,
    })),
  };
}

// ---- Workflow executions ---------------------------------------------------

export interface ExecutionDeepDive {
  available: boolean;
  countedFrom: Date | null;
  countedTo: Date | null;
  retainedFrom: Date | null;
  completed: number;
  failed: number;
  skipped: number;
  total: number;
  failureRate: number;
  medianMs: number | null;
  p90Ms: number | null;
  perWorkflow: { name: string; completed: number; failed: number; skipped: number; total: number; failureRate: number; medianMs: number | null }[];
  weekly: { weekStart: string; total: number; failed: number }[];
  peakWeek: { weekStart: string; total: number } | null;
  topErrors: { message: string; count: number }[];
  errorSampleSize: number;
}

export async function computeExecutionDeepDive(customerId: string, range: DateRange): Promise<ExecutionDeepDive> {
  // Exact period first; otherwise the most recent snapshot whose period covers this one.
  const snap =
    (await prisma.workflowExecutionSnapshot.findUnique({ where: { customerId_periodStart_periodEnd: { customerId, periodStart: range.start, periodEnd: range.end } } })) ??
    (await prisma.workflowExecutionSnapshot.findFirst({
      where: { customerId, periodStart: { lte: range.start }, periodEnd: { gte: range.end } },
      orderBy: { createdAt: "desc" },
    }));
  if (!snap) {
    return { available: false, countedFrom: null, countedTo: null, retainedFrom: null, completed: 0, failed: 0, skipped: 0, total: 0, failureRate: 0, medianMs: null, p90Ms: null, perWorkflow: [], weekly: [], peakWeek: null, topErrors: [], errorSampleSize: 0 };
  }
  type Wf = { name: string; completed: number; failed: number; skipped: number; medianMs: number | null };
  const perWorkflow = ((snap.perWorkflow as unknown as Wf[]) ?? [])
    .map((w) => {
      const total = w.completed + w.failed + w.skipped;
      return { ...w, total, failureRate: w.completed + w.failed ? w.failed / (w.completed + w.failed) : 0 };
    })
    .sort((a, b) => b.total - a.total);
  const weekly = (snap.weekly as unknown as ExecutionDeepDive["weekly"]) ?? [];
  const total = snap.completed + snap.failed + snap.skipped;
  const peak = weekly.reduce<ExecutionDeepDive["peakWeek"]>((best, w) => (!best || w.total > best.total ? { weekStart: w.weekStart, total: w.total } : best), null);
  return {
    available: true,
    countedFrom: snap.countedFrom,
    countedTo: snap.periodEnd,
    retainedFrom: snap.retainedFrom,
    completed: snap.completed,
    failed: snap.failed,
    skipped: snap.skipped,
    total,
    // Failure rate over runs that actually executed (skipped = trigger conditions not met).
    failureRate: snap.completed + snap.failed ? snap.failed / (snap.completed + snap.failed) : 0,
    medianMs: snap.medianMs,
    p90Ms: snap.p90Ms,
    perWorkflow,
    weekly,
    peakWeek: peak,
    topErrors: (snap.topErrors as unknown as ExecutionDeepDive["topErrors"]) ?? [],
    errorSampleSize: snap.errorSampleSize,
  };
}
