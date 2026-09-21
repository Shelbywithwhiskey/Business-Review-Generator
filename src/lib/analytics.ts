import { prisma } from "@/lib/db";
import type { DateRange } from "@/lib/zuper/modules";

// ---------------------------------------------------------------------------
// Deterministic metric computation. Nothing in this file calls the AI —
// every number here is calculated directly from synced rows, and this is the
// only thing the AI engine is ever allowed to see when writing narrative.
// ---------------------------------------------------------------------------

export interface JobMetrics {
  total: number;
  completed: number;
  cancelled: number;
  open: number;
  inProgress: number;
  completionRate: number;
  cancellationRate: number;
  totalJobValue: number;
  byServiceType: Record<string, number>;
}

export interface InvoiceMetrics {
  total: number;
  totalAmount: number;
  totalPaid: number;
  outstanding: number;
  byStatus: Record<string, number>;
  avgInvoiceValue: number;
  outstandingOver60Days: number;
}

export interface TechnicianRanking {
  name: string;
  jobsCompleted: number;
  completionRate: number;
  revenue: number;
  avgJobValue: number;
}

export interface PaymentMetrics {
  total: number;
  totalAmount: number;
  zuperPayAmount: number;
  zuperPayShare: number;
}

export interface PeriodMetrics {
  periodStart: string;
  periodEnd: string;
  jobs: JobMetrics;
  invoices: InvoiceMetrics;
  payments: PaymentMetrics;
  technicianRankings: TechnicianRanking[];
  top3TechShareOfJobs: number;
}

export async function computeJobMetrics(customerId: string, range: DateRange): Promise<JobMetrics> {
  const jobs = await prisma.job.findMany({
    where: { customerId, createdAt: { gte: range.start, lte: range.end } },
  });

  const byServiceType: Record<string, number> = {};
  let totalJobValue = 0;
  let completed = 0;
  let cancelled = 0;
  let open = 0;
  let inProgress = 0;

  for (const job of jobs) {
    const type = job.serviceType ?? "Unspecified";
    byServiceType[type] = (byServiceType[type] ?? 0) + 1;
    totalJobValue += job.jobValue ? Number(job.jobValue) : 0;
    if (job.status === "completed") completed += 1;
    else if (job.status === "cancelled") cancelled += 1;
    else if (job.status === "in_progress") inProgress += 1;
    else open += 1;
  }

  const total = jobs.length;
  return {
    total,
    completed,
    cancelled,
    open,
    inProgress,
    completionRate: total ? completed / total : 0,
    cancellationRate: total ? cancelled / total : 0,
    totalJobValue,
    byServiceType,
  };
}

export async function computeInvoiceMetrics(customerId: string, range: DateRange): Promise<InvoiceMetrics> {
  const invoices = await prisma.invoice.findMany({
    where: { customerId, issuedAt: { gte: range.start, lte: range.end } },
  });

  const byStatus: Record<string, number> = {};
  let totalAmount = 0;
  let totalPaid = 0;
  let outstandingOver60Days = 0;
  const now = Date.now();

  for (const inv of invoices) {
    byStatus[inv.status] = (byStatus[inv.status] ?? 0) + 1;
    totalAmount += Number(inv.amount);
    totalPaid += Number(inv.amountPaid);
    const outstanding = Number(inv.amount) - Number(inv.amountPaid);
    if (outstanding > 0 && inv.dueAt) {
      const daysPastDue = (now - inv.dueAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysPastDue > 60) outstandingOver60Days += outstanding;
    }
  }

  return {
    total: invoices.length,
    totalAmount,
    totalPaid,
    outstanding: totalAmount - totalPaid,
    byStatus,
    avgInvoiceValue: invoices.length ? totalAmount / invoices.length : 0,
    outstandingOver60Days,
  };
}

export async function computePaymentMetrics(customerId: string, range: DateRange): Promise<PaymentMetrics> {
  const payments = await prisma.payment.findMany({
    where: { customerId, paidAt: { gte: range.start, lte: range.end } },
  });

  let totalAmount = 0;
  let zuperPayAmount = 0;
  for (const p of payments) {
    totalAmount += Number(p.amount);
    if (p.zuperPayUsed) zuperPayAmount += Number(p.amount);
  }

  return {
    total: payments.length,
    totalAmount,
    zuperPayAmount,
    zuperPayShare: totalAmount ? zuperPayAmount / totalAmount : 0,
  };
}

/** Recomputes per-technician job rollups from the Job table for a period. Called after jobs+technicians sync. */
export async function computeTechnicianRollups(customerId: string, range: DateRange): Promise<void> {
  const [jobs, technicians] = await Promise.all([
    prisma.job.findMany({ where: { customerId, createdAt: { gte: range.start, lte: range.end } } }),
    prisma.technician.findMany({ where: { customerId, periodStart: range.start, periodEnd: range.end } }),
  ]);

  const byTech = new Map<string, { total: number; completed: number; revenue: number }>();
  for (const job of jobs) {
    if (!job.technicianId) continue;
    const entry = byTech.get(job.technicianId) ?? { total: 0, completed: 0, revenue: 0 };
    entry.total += 1;
    if (job.status === "completed") {
      entry.completed += 1;
      entry.revenue += job.jobValue ? Number(job.jobValue) : 0;
    }
    byTech.set(job.technicianId, entry);
  }

  await Promise.all(
    technicians.map((tech) => {
      const stats = byTech.get(tech.zuperUserId);
      if (!stats) return null;
      return prisma.technician.update({
        where: { id: tech.id },
        data: {
          jobsCompleted: stats.completed,
          completionRate: stats.total ? stats.completed / stats.total : 0,
          revenue: stats.revenue,
          avgJobValue: stats.completed ? stats.revenue / stats.completed : 0,
        },
      });
    })
  );
}

export async function computeTechnicianRankings(customerId: string, range: DateRange): Promise<TechnicianRanking[]> {
  const technicians = await prisma.technician.findMany({
    where: { customerId, periodStart: range.start, periodEnd: range.end },
    orderBy: { jobsCompleted: "desc" },
  });

  return technicians.map((t) => ({
    name: t.name,
    jobsCompleted: t.jobsCompleted,
    completionRate: Number(t.completionRate),
    revenue: Number(t.revenue),
    avgJobValue: Number(t.avgJobValue),
  }));
}

export async function computePeriodMetrics(customerId: string, range: DateRange): Promise<PeriodMetrics> {
  const [jobs, invoices, payments, technicianRankings] = await Promise.all([
    computeJobMetrics(customerId, range),
    computeInvoiceMetrics(customerId, range),
    computePaymentMetrics(customerId, range),
    computeTechnicianRankings(customerId, range),
  ]);

  const top3Jobs = technicianRankings.slice(0, 3).reduce((sum, t) => sum + t.jobsCompleted, 0);
  const top3TechShareOfJobs = jobs.completed ? top3Jobs / jobs.completed : 0;

  return {
    periodStart: range.start.toISOString(),
    periodEnd: range.end.toISOString(),
    jobs,
    invoices,
    payments,
    technicianRankings,
    top3TechShareOfJobs,
  };
}

export function previousPeriod(range: DateRange): DateRange {
  const lengthMs = range.end.getTime() - range.start.getTime();
  return { start: new Date(range.start.getTime() - lengthMs), end: new Date(range.start.getTime()) };
}

export interface ComparisonResult {
  current: PeriodMetrics;
  previous: PeriodMetrics;
  changePct: {
    jobsTotal: number | null;
    jobsCompleted: number | null;
    invoicesTotal: number | null;
    revenue: number | null;
    avgInvoiceValue: number | null;
  };
}

function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

export async function computeComparison(customerId: string, range: DateRange): Promise<ComparisonResult> {
  const prev = previousPeriod(range);
  const [current, previous] = await Promise.all([
    computePeriodMetrics(customerId, range),
    computePeriodMetrics(customerId, prev),
  ]);

  return {
    current,
    previous,
    changePct: {
      jobsTotal: pctChange(current.jobs.total, previous.jobs.total),
      jobsCompleted: pctChange(current.jobs.completed, previous.jobs.completed),
      invoicesTotal: pctChange(current.invoices.total, previous.invoices.total),
      revenue: pctChange(current.invoices.totalPaid, previous.invoices.totalPaid),
      avgInvoiceValue: pctChange(current.invoices.avgInvoiceValue, previous.invoices.avgInvoiceValue),
    },
  };
}

// ---- Rule-based recommendation triggers ----

export interface RuleMatch {
  key: string;
  severity: "low" | "medium" | "high";
  detail: string;
}

export function evaluateRules(metrics: PeriodMetrics, comparison?: ComparisonResult): RuleMatch[] {
  const matches: RuleMatch[] = [];

  if (comparison) {
    const cancellationChange = metrics.jobs.cancellationRate - comparison.previous.jobs.cancellationRate;
    if (cancellationChange > 0.02) {
      matches.push({
        key: "cancellation_rate_increase",
        severity: "medium",
        detail: `Cancellation rate rose from ${(comparison.previous.jobs.cancellationRate * 100).toFixed(1)}% to ${(metrics.jobs.cancellationRate * 100).toFixed(1)}%.`,
      });
    }
  }

  if (metrics.invoices.outstandingOver60Days > 5000) {
    matches.push({
      key: "invoice_aging_high",
      severity: "high",
      detail: `$${metrics.invoices.outstandingOver60Days.toFixed(0)} is outstanding on invoices more than 60 days past due.`,
    });
  }

  if (metrics.top3TechShareOfJobs > 0.5 && metrics.technicianRankings.length > 3) {
    matches.push({
      key: "technician_workload_concentration",
      severity: "medium",
      detail: `The top 3 technicians completed ${(metrics.top3TechShareOfJobs * 100).toFixed(0)}% of all completed jobs.`,
    });
  }

  if (metrics.payments.totalAmount > 20000 && metrics.payments.zuperPayShare < 0.1) {
    matches.push({
      key: "zuper_pay_opportunity",
      severity: "high",
      detail: `$${metrics.payments.totalAmount.toFixed(0)} in payments processed this period with only ${(metrics.payments.zuperPayShare * 100).toFixed(0)}% via Zuper Pay.`,
    });
  }

  return matches;
}

// ---- Health score ----

export interface HealthScoreResult {
  overall: number;
  dimensions: {
    productAdoption: number;
    operationalUsage: number;
    financialHealth: number;
  };
}

export function computeHealthScore(metrics: PeriodMetrics): HealthScoreResult {
  const operationalUsage = Math.round(metrics.jobs.completionRate * 100);
  const financialHealth = Math.round(
    metrics.invoices.totalAmount ? (metrics.invoices.totalPaid / metrics.invoices.totalAmount) * 100 : 100
  );
  const productAdoption = Math.round(metrics.payments.zuperPayShare * 100);

  const overall = Math.round(operationalUsage * 0.4 + financialHealth * 0.35 + productAdoption * 0.25);

  return { overall, dimensions: { productAdoption, operationalUsage, financialHealth } };
}
