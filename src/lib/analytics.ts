import { prisma } from "@/lib/db";
import type { DateRange } from "@/lib/zuper/modules";

// ---------------------------------------------------------------------------
// Deterministic metric computation. Nothing in this file calls the AI —
// every number here is calculated directly from synced rows, and this is the
// only thing the AI engine is ever allowed to see when writing narrative.
// ---------------------------------------------------------------------------

export interface StatusDetail {
  count: number;
  value: number;
}

export interface JobMetrics {
  total: number;
  completed: number;
  cancelled: number;
  open: number;
  inProgress: number;
  completionRate: number;
  cancellationRate: number;
  totalJobValue: number;
  avgJobValue: number;
  byServiceType: Record<string, number>;
  revenueByServiceType: Record<string, number>;
  /** Granular breakdown by Zuper's actual status label (e.g. "Waiting on Parts",
   * "Travel Time"), not the coarse completed/cancelled/open/in_progress bucket above. */
  byStatusDetail: Record<string, StatusDetail>;
}

export interface AgingBuckets {
  current: number;
  d1to30: number;
  d31to60: number;
  d61to90: number;
  d90plus: number;
}

export interface InvoiceStatusDetail {
  count: number;
  amount: number;
  amountPaid: number;
  outstanding: number;
}

export interface InvoiceMetrics {
  total: number;
  totalAmount: number;
  totalPaid: number;
  outstanding: number;
  byStatus: Record<string, number>;
  /** Same statuses as byStatus, but with dollar amounts per status — what was explicitly asked for. */
  byStatusDetail: Record<string, InvoiceStatusDetail>;
  avgInvoiceValue: number;
  outstandingOver60Days: number;
  aging: AgingBuckets;
  onTimePaymentRate: number | null;
}

export interface QuoteMetrics {
  total: number;
  totalValue: number;
  totalDiscount: number;
  convertedCount: number;
  convertedValue: number;
  conversionRate: number;
  avgQuoteValue: number;
  byStatus: Record<string, number>;
}

export interface TechnicianRanking {
  name: string;
  designation: string | null;
  jobsCompleted: number;
  completionRate: number;
  revenue: number;
  avgJobValue: number;
  hourlyRate: number | null;
  hoursWorked: number;
  laborCost: number | null;
}

export interface PaymentMetrics {
  total: number;
  totalAmount: number;
  onlineAmount: number;
  offlineAmount: number;
  onlineShare: number;
  /** Alias of onlineShare kept for the existing Zuper Pay opportunity rule — payment_mode_type
   * ("ONLINE"/"OFFLINE") is the closest proxy Zuper's API exposes for "collected digitally". */
  zuperPayShare: number;
  byMode: Record<string, number>;
}

export interface InventoryMetrics {
  totalItems: number;
  totalValue: number;
  totalPurchaseValue: number;
  lowStockCount: number;
}

export interface ExpenseMetrics {
  total: number;
  totalAmount: number;
  billableAmount: number;
}

export interface LedgerCustomer {
  name: string;
  ltv: number;
  receivables: number;
}

export interface LedgerMetrics {
  customerCount: number;
  activeCustomerCount: number;
  totalLtv: number;
  totalReceivables: number;
  totalCredits: number;
  topByLtv: LedgerCustomer[];
}

export interface PowerTechnician {
  name: string;
  designation: string | null;
  revenue: number;
  sharePctOfRevenue: number;
}

export interface DormantSeat {
  name: string;
  designation: string | null;
  licenseType: string | null;
  lastLoginAt: string | null;
}

export interface AtRiskCustomer {
  name: string;
  ltv: number;
  receivables: number;
}

/** Cross-cutting, non-obvious signals a CSM wouldn't easily compute by hand from the
 * Zuper UI — meant to be QBR/EBR talking points, not just raw totals. */
export interface KeyInsights {
  /** Highest-revenue technician this period and their share of total completed-job revenue. */
  powerTechnician: PowerTechnician | null;
  /** Licensed, active seats that haven't logged in during the period (or ever) — renewal/adoption risk. */
  dormantSeats: DormantSeat[];
  /** Share of Zuper's own total account LTV concentrated in the top 5 end customers — concentration risk. */
  revenueConcentrationTop5Pct: number;
  /** Share of the tenant's end customers who have placed more than one job, ever. */
  repeatCustomerRate: number;
  /** Average days between invoice issue and payment, for invoices paid this period. */
  avgDaysToPay: number | null;
  /** Average days between a quote being sent and accepted, for quotes converted this period. */
  avgDaysQuoteToClose: number | null;
  /** Service type with the highest total job revenue this period (not just job count). */
  topServiceTypeByRevenue: { type: string; revenue: number } | null;
  /** Top-LTV end customers (Zuper's all-time ledger) who had zero jobs in this period — dormant high-value accounts. */
  highValueCustomersInactiveThisPeriod: AtRiskCustomer[];
}

export interface PeriodMetrics {
  periodStart: string;
  periodEnd: string;
  jobs: JobMetrics;
  invoices: InvoiceMetrics;
  quotes: QuoteMetrics;
  payments: PaymentMetrics;
  inventory: InventoryMetrics;
  expenses: ExpenseMetrics;
  ledger: LedgerMetrics;
  technicianRankings: TechnicianRanking[];
  top3TechShareOfJobs: number;
  insights: KeyInsights;
}

export async function computeJobMetrics(customerId: string, range: DateRange): Promise<JobMetrics> {
  const jobs = await prisma.job.findMany({
    where: { customerId, createdAt: { gte: range.start, lte: range.end } },
  });

  const byServiceType: Record<string, number> = {};
  const revenueByServiceType: Record<string, number> = {};
  const byStatusDetail: Record<string, StatusDetail> = {};
  let totalJobValue = 0;
  let completed = 0;
  let cancelled = 0;
  let open = 0;
  let inProgress = 0;

  for (const job of jobs) {
    const type = job.serviceType ?? "Unspecified";
    const value = job.jobValue ? Number(job.jobValue) : 0;
    byServiceType[type] = (byServiceType[type] ?? 0) + 1;
    revenueByServiceType[type] = (revenueByServiceType[type] ?? 0) + value;
    totalJobValue += value;

    const statusLabel = job.rawStatusName ?? job.status;
    const detail = byStatusDetail[statusLabel] ?? { count: 0, value: 0 };
    detail.count += 1;
    detail.value += value;
    byStatusDetail[statusLabel] = detail;

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
    avgJobValue: total ? totalJobValue / total : 0,
    byServiceType,
    revenueByServiceType,
    byStatusDetail,
  };
}

function emptyAging(): AgingBuckets {
  return { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0 };
}

export async function computeInvoiceMetrics(customerId: string, range: DateRange): Promise<InvoiceMetrics> {
  const invoices = await prisma.invoice.findMany({
    where: { customerId, issuedAt: { gte: range.start, lte: range.end } },
  });

  const byStatus: Record<string, number> = {};
  const byStatusDetail: Record<string, InvoiceStatusDetail> = {};
  const aging = emptyAging();
  let totalAmount = 0;
  let totalPaid = 0;
  let outstandingOver60Days = 0;
  let paidOnTime = 0;
  let paidWithDueDate = 0;
  const now = Date.now();

  for (const inv of invoices) {
    const amount = Number(inv.amount);
    const amountPaid = Number(inv.amountPaid);
    const outstanding = amount - amountPaid;

    byStatus[inv.status] = (byStatus[inv.status] ?? 0) + 1;
    const detail = byStatusDetail[inv.status] ?? { count: 0, amount: 0, amountPaid: 0, outstanding: 0 };
    detail.count += 1;
    detail.amount += amount;
    detail.amountPaid += amountPaid;
    detail.outstanding += outstanding;
    byStatusDetail[inv.status] = detail;

    totalAmount += amount;
    totalPaid += amountPaid;

    if (outstanding > 0 && inv.dueAt) {
      const daysPastDue = (now - inv.dueAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysPastDue > 60) outstandingOver60Days += outstanding;
      if (daysPastDue <= 0) aging.current += outstanding;
      else if (daysPastDue <= 30) aging.d1to30 += outstanding;
      else if (daysPastDue <= 60) aging.d31to60 += outstanding;
      else if (daysPastDue <= 90) aging.d61to90 += outstanding;
      else aging.d90plus += outstanding;
    }

    if (inv.isPaid && inv.dueAt && inv.paidAt) {
      paidWithDueDate += 1;
      if (inv.paidAt.getTime() <= inv.dueAt.getTime()) paidOnTime += 1;
    }
  }

  return {
    total: invoices.length,
    totalAmount,
    totalPaid,
    outstanding: totalAmount - totalPaid,
    byStatus,
    byStatusDetail,
    avgInvoiceValue: invoices.length ? totalAmount / invoices.length : 0,
    outstandingOver60Days,
    aging,
    onTimePaymentRate: paidWithDueDate ? paidOnTime / paidWithDueDate : null,
  };
}

export async function computeQuoteMetrics(customerId: string, range: DateRange): Promise<QuoteMetrics> {
  const quotes = await prisma.quote.findMany({
    where: { customerId, estimateAt: { gte: range.start, lte: range.end } },
  });

  const byStatus: Record<string, number> = {};
  let totalValue = 0;
  let totalDiscount = 0;
  let convertedCount = 0;
  let convertedValue = 0;

  for (const q of quotes) {
    byStatus[q.status] = (byStatus[q.status] ?? 0) + 1;
    totalValue += Number(q.value);
    totalDiscount += Number(q.discount);
    if (q.isConverted) {
      convertedCount += 1;
      convertedValue += Number(q.value);
    }
  }

  const total = quotes.length;
  return {
    total,
    totalValue,
    totalDiscount,
    convertedCount,
    convertedValue,
    conversionRate: total ? convertedCount / total : 0,
    avgQuoteValue: total ? totalValue / total : 0,
    byStatus,
  };
}

export async function computePaymentMetrics(customerId: string, range: DateRange): Promise<PaymentMetrics> {
  const payments = await prisma.payment.findMany({
    where: { customerId, paidAt: { gte: range.start, lte: range.end } },
  });

  let totalAmount = 0;
  let onlineAmount = 0;
  let offlineAmount = 0;
  const byMode: Record<string, number> = {};

  for (const p of payments) {
    const amount = Number(p.amount);
    totalAmount += amount;
    if (p.paymentModeType === "ONLINE") onlineAmount += amount;
    else offlineAmount += amount;
    const modeLabel = p.paymentModeName ?? "Unknown";
    byMode[modeLabel] = (byMode[modeLabel] ?? 0) + amount;
  }

  const onlineShare = totalAmount ? onlineAmount / totalAmount : 0;
  return {
    total: payments.length,
    totalAmount,
    onlineAmount,
    offlineAmount,
    onlineShare,
    zuperPayShare: onlineShare,
    byMode,
  };
}

/** Inventory is a current snapshot, not period-scoped — every sync overwrites the catalog. */
export async function computeInventoryMetrics(customerId: string): Promise<InventoryMetrics> {
  const products = await prisma.product.findMany({ where: { customerId } });

  let totalValue = 0;
  let totalPurchaseValue = 0;
  let lowStockCount = 0;

  for (const p of products) {
    const qty = Number(p.quantity);
    if (qty > 0) {
      totalValue += qty * Number(p.price);
      totalPurchaseValue += qty * Number(p.purchasePrice);
    }
    if (p.lowStock) lowStockCount += 1;
  }

  return { totalItems: products.length, totalValue, totalPurchaseValue, lowStockCount };
}

export async function computeExpenseMetrics(customerId: string, range: DateRange): Promise<ExpenseMetrics> {
  const expenses = await prisma.expense.findMany({
    where: { customerId, incurredAt: { gte: range.start, lte: range.end } },
  });

  let totalAmount = 0;
  let billableAmount = 0;
  for (const e of expenses) {
    const amount = Number(e.amount);
    totalAmount += amount;
    if (e.isBillable) billableAmount += amount;
  }

  return { total: expenses.length, totalAmount, billableAmount };
}

export interface LineItemUsageEntry {
  name: string;
  category: string | null;
  /** Number of distinct jobs this item was added to — the ranking key ("most used"). */
  jobCount: number;
  quantity: number;
  revenue: number;
  /** Share of this type's line-item revenue. */
  revenueShare: number;
}

export interface LineItemTypeUsage {
  jobCount: number;
  distinctItems: number;
  totalQuantity: number;
  totalRevenue: number;
  top: LineItemUsageEntry[];
}

export interface LineItemUsage {
  jobsTotal: number;
  jobsWithLineItems: number;
  /** Share of the period's jobs that had at least one part/product/service on them. */
  attachRate: number;
  totalRevenue: number;
  parts: LineItemTypeUsage;
  products: LineItemTypeUsage;
  services: LineItemTypeUsage;
}

type UsageBucket = "parts" | "products" | "services";

function usageBucket(productType: string): UsageBucket | null {
  if (productType.startsWith("PART")) return "parts";
  if (productType === "PRODUCT") return "products";
  if (productType === "SERVICE") return "services";
  return null;
}

export interface LineItemRow {
  zuperJobId: string;
  productUid: string | null;
  name: string;
  productType: string;
  category: string | null;
  quantity: number | { toString(): string };
  total: number | { toString(): string };
}

/** Parts, products and services used on jobs created in the period, ranked by how many jobs used each item. */
export async function computeLineItemUsage(customerId: string, range: DateRange, topN = 5): Promise<LineItemUsage> {
  const [items, jobsTotal] = await Promise.all([
    prisma.jobLineItem.findMany({
      where: { customerId, jobCreatedAt: { gte: range.start, lte: range.end } },
      select: { zuperJobId: true, productUid: true, name: true, productType: true, category: true, quantity: true, total: true },
    }),
    prisma.job.count({ where: { customerId, createdAt: { gte: range.start, lte: range.end } } }),
  ]);
  return summarizeLineItemUsage(items, jobsTotal, topN);
}

export function summarizeLineItemUsage(items: LineItemRow[], jobsTotal: number, topN = 5): LineItemUsage {
  type Agg = { name: string; category: string | null; jobs: Set<string>; quantity: number; revenue: number };
  const groups: Record<UsageBucket, Map<string, Agg>> = { parts: new Map(), products: new Map(), services: new Map() };
  const jobsByBucket: Record<UsageBucket, Set<string>> = { parts: new Set(), products: new Set(), services: new Set() };
  const jobsWithLineItems = new Set<string>();
  let totalRevenue = 0;

  for (const item of items) {
    const revenue = Number(item.total);
    jobsWithLineItems.add(item.zuperJobId);
    totalRevenue += revenue;

    const bucket = usageBucket(item.productType);
    if (!bucket) continue;
    jobsByBucket[bucket].add(item.zuperJobId);
    const key = item.productUid ?? item.name;
    const agg = groups[bucket].get(key) ?? { name: item.name, category: item.category, jobs: new Set(), quantity: 0, revenue: 0 };
    agg.jobs.add(item.zuperJobId);
    agg.quantity += Number(item.quantity);
    agg.revenue += revenue;
    groups[bucket].set(key, agg);
  }

  const summarize = (bucket: UsageBucket): LineItemTypeUsage => {
    const all = [...groups[bucket].values()];
    const bucketRevenue = all.reduce((sum, a) => sum + a.revenue, 0);
    return {
      jobCount: jobsByBucket[bucket].size,
      distinctItems: all.length,
      totalQuantity: all.reduce((sum, a) => sum + a.quantity, 0),
      totalRevenue: bucketRevenue,
      top: all
        .sort((a, b) => b.jobs.size - a.jobs.size || b.revenue - a.revenue)
        .slice(0, topN)
        .map((a) => ({
          name: a.name,
          category: a.category,
          jobCount: a.jobs.size,
          quantity: a.quantity,
          revenue: a.revenue,
          revenueShare: bucketRevenue ? a.revenue / bucketRevenue : 0,
        })),
    };
  };

  return {
    jobsTotal,
    jobsWithLineItems: jobsWithLineItems.size,
    attachRate: jobsTotal ? jobsWithLineItems.size / jobsTotal : 0,
    totalRevenue,
    parts: summarize("parts"),
    products: summarize("products"),
    services: summarize("services"),
  };
}

/** Zuper's own end-customer ledger (LTV/receivables/credits) — a current snapshot, not period-scoped. */
export async function computeLedgerMetrics(customerId: string): Promise<LedgerMetrics> {
  const endCustomers = await prisma.endCustomerLedger.findMany({ where: { customerId } });

  let totalLtv = 0;
  let totalReceivables = 0;
  let totalCredits = 0;
  let activeCustomerCount = 0;

  for (const c of endCustomers) {
    totalLtv += Number(c.ltv);
    totalReceivables += Number(c.receivables);
    totalCredits += Number(c.credits);
    if (c.isActive) activeCustomerCount += 1;
  }

  const topByLtv = [...endCustomers]
    .sort((a, b) => Number(b.ltv) - Number(a.ltv))
    .slice(0, 5)
    .map((c) => ({ name: c.name, ltv: Number(c.ltv), receivables: Number(c.receivables) }));

  return {
    customerCount: endCustomers.length,
    activeCustomerCount,
    totalLtv,
    totalReceivables,
    totalCredits,
    topByLtv,
  };
}

/** Recomputes per-technician job rollups from the Job table for a period. Called after jobs+teams sync. */
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

/** Pairs CHECK_IN/CHECK_OUT TimesheetEvent rows chronologically per technician and sums the
 * resulting durations into Technician.hoursWorked for the period. Called after timesheets+teams sync. */
export async function computeTimesheetHours(customerId: string, range: DateRange): Promise<void> {
  const [events, technicians] = await Promise.all([
    prisma.timesheetEvent.findMany({
      where: { customerId, checkedAt: { gte: range.start, lte: range.end } },
      orderBy: { checkedAt: "asc" },
    }),
    prisma.technician.findMany({ where: { customerId, periodStart: range.start, periodEnd: range.end } }),
  ]);

  const byUser = new Map<string, typeof events>();
  for (const e of events) {
    const list = byUser.get(e.zuperUserId) ?? [];
    list.push(e);
    byUser.set(e.zuperUserId, list);
  }

  const hoursByUser = new Map<string, number>();
  for (const [userId, userEvents] of byUser) {
    let totalMs = 0;
    let openCheckIn: Date | null = null;
    for (const event of userEvents) {
      if (event.typeOfCheck === "CHECK_IN") {
        openCheckIn = event.checkedAt;
      } else if (event.typeOfCheck === "CHECK_OUT" && openCheckIn) {
        totalMs += event.checkedAt.getTime() - openCheckIn.getTime();
        openCheckIn = null;
      }
    }
    hoursByUser.set(userId, totalMs / (1000 * 60 * 60));
  }

  await Promise.all(
    technicians.map((tech) => {
      const hours = hoursByUser.get(tech.zuperUserId);
      if (hours == null) return null;
      return prisma.technician.update({ where: { id: tech.id }, data: { hoursWorked: hours } });
    })
  );
}

export async function computeTechnicianRankings(customerId: string, range: DateRange): Promise<TechnicianRanking[]> {
  const technicians = await prisma.technician.findMany({
    where: { customerId, periodStart: range.start, periodEnd: range.end },
    orderBy: { jobsCompleted: "desc" },
  });

  return technicians.map((t) => {
    const hourlyRate = t.hourlyRate != null ? Number(t.hourlyRate) : null;
    const hoursWorked = Number(t.hoursWorked);
    return {
      name: t.name,
      designation: t.designation,
      jobsCompleted: t.jobsCompleted,
      completionRate: Number(t.completionRate),
      revenue: Number(t.revenue),
      avgJobValue: Number(t.avgJobValue),
      hourlyRate,
      hoursWorked,
      laborCost: hourlyRate != null ? hourlyRate * hoursWorked : null,
    };
  });
}

/** Reuses jobMetrics/technicianRankings/ledger already computed by the caller and adds the
 * queries needed for cross-cutting signals that aren't otherwise surfaced anywhere. */
export async function computeKeyInsights(
  customerId: string,
  range: DateRange,
  jobMetrics: JobMetrics,
  technicianRankings: TechnicianRanking[],
  ledger: LedgerMetrics
): Promise<KeyInsights> {
  const [quotesConvertedThisPeriod, invoicesPaidThisPeriod, periodJobs, technicians, endCustomers] = await Promise.all([
    prisma.quote.findMany({
      where: { customerId, isConverted: true, convertedAt: { gte: range.start, lte: range.end }, sentAt: { not: null } },
      select: { sentAt: true, acceptedAt: true, convertedAt: true },
    }),
    prisma.invoice.findMany({
      where: { customerId, isPaid: true, paidAt: { gte: range.start, lte: range.end } },
      select: { issuedAt: true, paidAt: true },
    }),
    prisma.job.findMany({
      where: { customerId, createdAt: { gte: range.start, lte: range.end }, endCustomerId: { not: null } },
      select: { endCustomerId: true },
    }),
    prisma.technician.findMany({ where: { customerId, periodStart: range.start, periodEnd: range.end } }),
    prisma.endCustomerLedger.findMany({ where: { customerId } }),
  ]);

  // Power technician: highest revenue this period, and their share of all technician revenue.
  const totalTechRevenue = technicianRankings.reduce((sum, t) => sum + t.revenue, 0);
  const topTech = [...technicianRankings].sort((a, b) => b.revenue - a.revenue)[0];
  const powerTechnician: PowerTechnician | null = topTech
    ? {
        name: topTech.name,
        designation: topTech.designation,
        revenue: topTech.revenue,
        sharePctOfRevenue: totalTechRevenue ? topTech.revenue / totalTechRevenue : 0,
      }
    : null;

  // Dormant seats: active licensed users who haven't logged in within the period window (or ever).
  const dormantSeats: DormantSeat[] = technicians
    .filter((t) => t.isActive && (!t.lastLoginAt || t.lastLoginAt < range.start))
    .map((t) => ({
      name: t.name,
      designation: t.designation,
      licenseType: t.licenseType,
      lastLoginAt: t.lastLoginAt ? t.lastLoginAt.toISOString() : null,
    }));

  // Revenue concentration: share of total account LTV held by the top 5 end customers.
  const sortedByLtv = [...endCustomers].sort((a, b) => Number(b.ltv) - Number(a.ltv));
  const top5LtvSum = sortedByLtv.slice(0, 5).reduce((sum, c) => sum + Number(c.ltv), 0);
  const revenueConcentrationTop5Pct = ledger.totalLtv ? top5LtvSum / ledger.totalLtv : 0;

  // Repeat customer rate across the tenant's full end-customer base (all-time, not period-scoped).
  const repeatCustomerRate = endCustomers.length
    ? endCustomers.filter((c) => c.noOfJobs > 1).length / endCustomers.length
    : 0;

  // Avg days to pay, for invoices actually paid this period.
  const daysToPay = invoicesPaidThisPeriod
    .filter((i) => i.paidAt)
    .map((i) => (i.paidAt!.getTime() - i.issuedAt.getTime()) / (1000 * 60 * 60 * 24));
  const avgDaysToPay = daysToPay.length ? daysToPay.reduce((a, b) => a + b, 0) / daysToPay.length : null;

  // Avg days from quote sent to accepted, for quotes converted this period.
  const daysToClose = quotesConvertedThisPeriod
    .filter((q) => q.sentAt && q.acceptedAt)
    .map((q) => (q.acceptedAt!.getTime() - q.sentAt!.getTime()) / (1000 * 60 * 60 * 24));
  const avgDaysQuoteToClose = daysToClose.length ? daysToClose.reduce((a, b) => a + b, 0) / daysToClose.length : null;

  // Top service type by revenue (distinct from the count-based byServiceType breakdown).
  const revenueEntries = Object.entries(jobMetrics.revenueByServiceType).sort((a, b) => b[1] - a[1]);
  const topServiceTypeByRevenue = revenueEntries.length
    ? { type: revenueEntries[0][0], revenue: revenueEntries[0][1] }
    : null;

  // High-value customers (top 10 by all-time LTV) with zero jobs logged in this period.
  const activeEndCustomerIds = new Set(periodJobs.map((j) => j.endCustomerId).filter((id): id is string => !!id));
  const highValueCustomersInactiveThisPeriod: AtRiskCustomer[] = sortedByLtv
    .slice(0, 10)
    .filter((c) => !activeEndCustomerIds.has(c.zuperCustomerId))
    .map((c) => ({ name: c.name, ltv: Number(c.ltv), receivables: Number(c.receivables) }));

  return {
    powerTechnician,
    dormantSeats,
    revenueConcentrationTop5Pct,
    repeatCustomerRate,
    avgDaysToPay,
    avgDaysQuoteToClose,
    topServiceTypeByRevenue,
    highValueCustomersInactiveThisPeriod,
  };
}

export async function computePeriodMetrics(customerId: string, range: DateRange): Promise<PeriodMetrics> {
  const [jobs, invoices, quotes, payments, inventory, expenses, ledger, technicianRankings] = await Promise.all([
    computeJobMetrics(customerId, range),
    computeInvoiceMetrics(customerId, range),
    computeQuoteMetrics(customerId, range),
    computePaymentMetrics(customerId, range),
    computeInventoryMetrics(customerId),
    computeExpenseMetrics(customerId, range),
    computeLedgerMetrics(customerId),
    computeTechnicianRankings(customerId, range),
  ]);

  const top3Jobs = technicianRankings.slice(0, 3).reduce((sum, t) => sum + t.jobsCompleted, 0);
  const top3TechShareOfJobs = jobs.completed ? top3Jobs / jobs.completed : 0;

  const insights = await computeKeyInsights(customerId, range, jobs, technicianRankings, ledger);

  return {
    periodStart: range.start.toISOString(),
    periodEnd: range.end.toISOString(),
    jobs,
    invoices,
    quotes,
    payments,
    inventory,
    expenses,
    ledger,
    technicianRankings,
    top3TechShareOfJobs,
    insights,
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
    quotesValue: number | null;
    quotesConversionRate: number | null;
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
      quotesValue: pctChange(current.quotes.totalValue, previous.quotes.totalValue),
      quotesConversionRate: pctChange(current.quotes.conversionRate, previous.quotes.conversionRate),
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
      detail: `$${metrics.payments.totalAmount.toFixed(0)} in payments processed this period with only ${(metrics.payments.zuperPayShare * 100).toFixed(0)}% collected digitally.`,
    });
  }

  if (metrics.quotes.total >= 5 && metrics.quotes.conversionRate < 0.3) {
    matches.push({
      key: "quote_conversion_low",
      severity: "medium",
      detail: `Only ${(metrics.quotes.conversionRate * 100).toFixed(0)}% of ${metrics.quotes.total} quotes sent this period converted.`,
    });
  }

  if (metrics.inventory.lowStockCount > 0) {
    matches.push({
      key: "inventory_low_stock",
      severity: "low",
      detail: `${metrics.inventory.lowStockCount} inventory item(s) are at or below their minimum stock level.`,
    });
  }

  if (metrics.insights.dormantSeats.length > 0) {
    matches.push({
      key: "dormant_licensed_seats",
      severity: "medium",
      detail: `${metrics.insights.dormantSeats.length} licensed seat(s) haven't logged in this period: ${metrics.insights.dormantSeats.map((s) => s.name).join(", ")}.`,
    });
  }

  if (metrics.insights.highValueCustomersInactiveThisPeriod.length > 0) {
    const top = metrics.insights.highValueCustomersInactiveThisPeriod[0];
    matches.push({
      key: "high_value_customer_churn_risk",
      severity: "high",
      detail: `${metrics.insights.highValueCustomersInactiveThisPeriod.length} of the account's top-10 lifetime-value customers had no jobs this period, including ${top.name} ($${top.ltv.toFixed(0)} LTV).`,
    });
  }

  if (metrics.insights.revenueConcentrationTop5Pct > 0.5 && metrics.ledger.customerCount > 10) {
    matches.push({
      key: "customer_concentration_risk",
      severity: "medium",
      detail: `The top 5 customers account for ${(metrics.insights.revenueConcentrationTop5Pct * 100).toFixed(0)}% of the account's total lifetime value.`,
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
