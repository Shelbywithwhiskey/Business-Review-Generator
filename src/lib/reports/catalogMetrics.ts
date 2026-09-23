import { prisma } from "@/lib/db";
import { CATALOG, NOT_IN_API, type CatalogModule, type ProductArea } from "@/lib/zuper/catalog";
import type { CompactRecord } from "@/lib/zuper/compact";
import type { DateRange } from "@/lib/zuper/modules";

// ---------------------------------------------------------------------------
// Deterministic analysis of the catalog modules (ZuperRecord rows). Field names
// differ per module and are partly unverified, so dimensions (status/type/...)
// and amounts are detected from the data itself, and every result names the
// exact field it was computed from — the slide notes quote those field names.
// ---------------------------------------------------------------------------

const DAY = 864e5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface Breakdown {
  field: string;
  label: string;
  filled: number;
  values: { name: string; count: number }[];
}

export interface AmountSummary {
  field: string;
  label: string;
  filled: number;
  total: number;
  inPeriod: number;
}

export interface Highlight {
  label: string;
  value: string;
  definition: string;
  alert?: boolean;
}

export interface CoverageRow {
  module: string;
  label: string;
  area: ProductArea | "Core";
  endpoint: string;
  status: string;
  recordCount: number;
  totalRecords: number | null;
  truncated: boolean;
  message: string | null;
  fetchedAt: Date | null;
  topFields: { path: string; filled: number }[];
}

export interface ModuleAnalysis {
  key: string;
  label: string;
  area: ProductArea;
  describe: string;
  coverage: CoverageRow;
  total: number;
  /** Records whose created/primary date falls in the period (null when records carry no date). */
  inPeriod: number | null;
  dated: number;
  monthly: { label: string; count: number }[];
  breakdowns: Breakdown[];
  amount: AmountSummary | null;
  highlights: Highlight[];
}

export function humanize(path: string): string {
  const last = path.split(".").filter((p) => p !== "names" && p !== "length");
  const base = last.length > 1 && /^(name|status_name|category_name|type)$/.test(last[last.length - 1]) ? last[last.length - 2] : last[last.length - 1];
  const s = (base ?? path).replace(/_uid$/, "").replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DIM_KEY = /(status|type|stage|priority|category|direction|source|mode|role|designation|frequency|method|reason|outcome)/i;
const DIM_EXCLUDE = /(uid|_id$|color|colour|date|time|_at$|url|email|phone|description|note|address)/i;
const AMOUNT_KEY = /(total|amount|value|price|cost|charge|earned|balance)/i;
const AMOUNT_EXCLUDE = /(count|qty|quantity|percent|rate|no_of|length|_uid|tax_rate|discount_rate)/i;

function detectBreakdowns(rows: CompactRecord[], max = 2): Breakdown[] {
  if (!rows.length) return [];
  const keys = new Set<string>();
  for (const r of rows.slice(0, 500)) for (const k of Object.keys(r)) keys.add(k);
  const candidates: (Breakdown & { score: number })[] = [];
  for (const k of keys) {
    if (!DIM_KEY.test(k) || DIM_EXCLUDE.test(k)) continue;
    const counts = new Map<string, number>();
    let filled = 0;
    for (const r of rows) {
      const v = r[k];
      if (typeof v !== "string" || !v.trim()) continue;
      filled += 1;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    if (filled < rows.length * 0.3 || counts.size < 2 || counts.size > 25) continue;
    const values = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    const depth = k.split(".").length;
    candidates.push({ field: k, label: humanize(k), filled, values, score: filled / rows.length - depth * 0.05 - (counts.size > 12 ? 0.2 : 0) });
  }
  const picked: Breakdown[] = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (picked.some((p) => p.label === c.label || JSON.stringify(p.values.slice(0, 3)) === JSON.stringify(c.values.slice(0, 3)))) continue;
    picked.push({ field: c.field, label: c.label, filled: c.filled, values: c.values.slice(0, 8) });
    if (picked.length >= max) break;
  }
  return picked;
}

function detectAmount(rows: { data: CompactRecord; at: Date | null }[], range: DateRange): AmountSummary | null {
  if (!rows.length) return null;
  const keys = new Set<string>();
  for (const r of rows.slice(0, 500)) for (const [k, v] of Object.entries(r.data)) if (typeof v === "number") keys.add(k);
  let best: AmountSummary | null = null;
  for (const k of keys) {
    if (!AMOUNT_KEY.test(k) || AMOUNT_EXCLUDE.test(k)) continue;
    let filled = 0;
    let total = 0;
    let inPeriod = 0;
    for (const r of rows) {
      const v = r.data[k];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (v !== 0) filled += 1;
      total += v;
      if (r.at && r.at >= range.start && r.at <= range.end) inPeriod += v;
    }
    if (filled < rows.length * 0.3 || total <= 0) continue;
    // Prefer top-level "total"-style fields over nested ones.
    const rank = (f: string) => (f.split(".").length === 1 ? 1 : 0) + (/total/.test(f) ? 0.5 : 0);
    if (!best || filled > best.filled * 1.2 || (filled >= best.filled * 0.8 && rank(k) > rank(best.field))) {
      best = { field: k, label: humanize(k), filled, total, inPeriod };
    }
  }
  return best;
}

function monthsOf(range: DateRange, dates: Date[]): { label: string; count: number }[] {
  const out: { label: string; count: number }[] = [];
  let cur = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), 1));
  while (cur <= range.end) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    out.push({ label: `${MONTHS[cur.getUTCMonth()]} ${String(cur.getUTCFullYear()).slice(2)}`, count: dates.filter((d) => d >= cur && d < next).length });
    cur = next;
  }
  return out.slice(-12);
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null);
const date = (v: unknown) => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const truthy = (v: unknown) => v === true || v === "true" || v === 1;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const money = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n).toLocaleString("en-US")}`);
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/** Module-specific call-outs on top of the generic breakdowns. Every definition names its field. */
function moduleHighlights(mod: CatalogModule, rows: { data: CompactRecord; at: Date | null }[], range: DateRange, coverage: CoverageRow): Highlight[] {
  const now = Date.now();
  const h: Highlight[] = [];
  const data = rows.map((r) => r.data);
  const count = (pred: (r: CompactRecord) => boolean) => data.filter(pred).length;
  const sum = (field: string, pred: (r: CompactRecord) => boolean = () => true) => data.filter(pred).reduce((s, r) => s + (num(r[field]) ?? 0), 0);

  if (mod.countOnly) {
    h.push({ label: mod.label, value: fmt(coverage.recordCount), definition: `Zuper's total_records for ${coverage.endpoint} at sync time.` });
    return h;
  }
  switch (mod.key) {
    case "service_contracts": {
      const active = count((r) => truthy(r.is_active) && !truthy(r.is_expired));
      const expiring = count((r) => {
        const end = date(r.end_date);
        return !!end && end.getTime() >= now && end.getTime() <= now + 90 * DAY && !truthy(r.is_expired);
      });
      h.push({ label: "Active contracts", value: fmt(active), definition: "is_active = true and is_expired = false." });
      h.push({ label: "Expiring in the next 90 days", value: fmt(expiring), definition: "end_date within 90 days of today, not yet expired.", alert: expiring > 0 });
      const value = sum("contract_total", (r) => truthy(r.is_active) && !truthy(r.is_expired));
      if (value > 0) h.push({ label: "Value of active contracts", value: money(value), definition: "Sum of contract_total on active contracts." });
      break;
    }
    case "assets": {
      const warranty = count((r) => {
        const d = date(r.warranty_expiry_date);
        return !!d && d.getTime() >= now && d.getTime() <= now + 90 * DAY;
      });
      const withCustomer = count((r) => Object.keys(r).some((k) => k.startsWith("customer.") || k.startsWith("owned_by_customer")));
      h.push({ label: "Warranties expiring in 90 days", value: fmt(warranty), definition: "warranty_expiry_date within 90 days of today — a service/upsell prompt.", alert: warranty > 0 });
      h.push({ label: "Linked to a customer", value: pct(data.length ? withCustomer / data.length : 0), definition: "Assets with a customer / owner recorded." });
      break;
    }
    case "organizations_portal": {
      const enabled = count((r) => truthy(r.is_portal_enabled));
      h.push({ label: "Organizations with portal access", value: `${fmt(enabled)} of ${fmt(data.length)}`, definition: "is_portal_enabled = true on the organization." });
      break;
    }
    case "job_timelogs": {
      let ms = 0;
      const jobs = new Set<string>();
      const users = new Set<string>();
      for (const r of rows) {
        const a = date(r.data.clock_in_time);
        const b = date(r.data.clock_out_time);
        if (!a || !b || a < range.start || a > range.end || b <= a) continue;
        ms += b.getTime() - a.getTime();
        if (r.data["job.job_uid"]) jobs.add(String(r.data["job.job_uid"]));
        if (r.data["user.user_uid"]) users.add(String(r.data["user.user_uid"]));
      }
      h.push({ label: "Hours logged on jobs", value: fmt(ms / 36e5), definition: "Sum of clock_out_time − clock_in_time for time logs clocked in during the period." });
      h.push({ label: "Jobs with time logged", value: fmt(jobs.size), definition: "Distinct job.job_uid across those time logs." });
      h.push({ label: "People logging time", value: fmt(users.size), definition: "Distinct user.user_uid across those time logs." });
      const earned = sum("amount_earned", (r) => {
        const a = date(r.clock_in_time);
        return !!a && a >= range.start && a <= range.end;
      });
      if (earned > 0) h.push({ label: "Labor value (amount earned)", value: money(earned), definition: "Sum of Zuper's amount_earned (time × hourly charge) on those time logs." });
      break;
    }
    case "user_timelogs": {
      const work = sum("total_work_time");
      const travel = sum("total_travel_time");
      const brk = sum("total_break_time");
      const all = work + travel + brk;
      if (all > 0) {
        h.push({ label: "Share of time working", value: pct(work / all), definition: "total_work_time ÷ (work + travel + break), summed across users for the period." });
        h.push({ label: "Share of time travelling", value: pct(travel / all), definition: "total_travel_time ÷ (work + travel + break).", alert: travel / all > 0.3 });
      }
      break;
    }
    case "connect_calls": {
      const missed = count((r) => Object.entries(r).some(([k, v]) => /status/i.test(k) && typeof v === "string" && /miss|no.?answer|unanswer|abandon|voicemail/i.test(v)));
      const ai = count((r) => Object.entries(r).some(([k, v]) => /(^|_|\.)(ai|agent|bot|virtual|csr)/i.test(k) && (v === true || (typeof v === "string" && v.trim() !== "" && !/false|none|null/i.test(v)))));
      const inbound = count((r) => Object.entries(r).some(([k, v]) => /direction/i.test(k) && typeof v === "string" && /in/i.test(v)));
      const periodCalls = rows.filter((r) => r.at && r.at >= range.start && r.at <= range.end).length;
      h.push({ label: "Calls in the period", value: fmt(periodCalls), definition: "Call records whose created_at falls in the period." });
      if (inbound) h.push({ label: "Inbound calls", value: fmt(inbound), definition: "Calls whose direction field reads inbound (all synced calls)." });
      h.push({ label: "Missed / unanswered", value: fmt(missed), definition: "Calls whose status reads missed, no-answer, abandoned or voicemail — the calls CSR Agent is built to catch.", alert: missed > 0 });
      if (ai) h.push({ label: "Handled by AI / CSR Agent", value: fmt(ai), definition: "Calls carrying an AI/agent/bot flag or agent value." });
      break;
    }
    case "credit_notes": {
      const remaining = sum("remaining_amount");
      if (remaining > 0) h.push({ label: "Unused credit", value: money(remaining), definition: "Sum of remaining_amount across credit notes — owed back to customers." });
      break;
    }
    case "users": {
      const active = count((r) => r.is_active !== false && r.is_active !== "false");
      h.push({ label: "Active users", value: `${fmt(active)} of ${fmt(data.length)}`, definition: "Users not marked is_active = false." });
      break;
    }
    case "routes": {
      const optimized = count((r) => truthy(r.is_optimized));
      const jobs = sum("total_jobs");
      if (jobs > 0) h.push({ label: "Jobs on routes", value: fmt(jobs), definition: "Sum of total_jobs across routes." });
      h.push({ label: "Optimized routes", value: `${fmt(optimized)} of ${fmt(data.length)}`, definition: "is_optimized = true." });
      break;
    }
  }
  return h;
}

async function loadCoverage(customerId: string): Promise<Map<string, CoverageRow>> {
  const rows = await prisma.moduleCoverage.findMany({ where: { customerId } });
  const area = new Map<string, ProductArea>([...CATALOG.map((c) => [c.key, c.area] as const), ...NOT_IN_API.map((n) => [n.key, n.area] as const)]);
  return new Map(
    rows.map((r) => [
      r.module,
      {
        module: r.module,
        label: r.label,
        area: area.get(r.module) ?? "Core",
        endpoint: r.endpoint,
        status: r.status,
        recordCount: r.recordCount,
        totalRecords: r.totalRecords,
        truncated: r.truncated,
        message: r.message,
        fetchedAt: r.fetchedAt,
        topFields: ((r.fieldStats as { path: string; filled: number }[] | null) ?? []).slice(0, 12),
      },
    ])
  );
}

export async function computeCoverage(customerId: string): Promise<CoverageRow[]> {
  const order = ["Core", ...new Set([...CATALOG.map((c) => c.area)])];
  return [...(await loadCoverage(customerId)).values()].sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area) || a.label.localeCompare(b.label));
}

/** Pure analysis of one module's stored records (no database access). */
export function analyzeModule(mod: CatalogModule, rows: { data: CompactRecord; at: Date | null }[], range: DateRange, cov: CoverageRow): ModuleAnalysis {
  const dates = rows.map((r) => r.at).filter((d): d is Date => !!d);
  return {
    key: mod.key,
    label: mod.label,
    area: mod.area,
    describe: mod.describe,
    coverage: cov,
    total: mod.countOnly ? cov.recordCount : rows.length,
    inPeriod: dates.length ? dates.filter((d) => d >= range.start && d <= range.end).length : null,
    dated: dates.length,
    monthly: dates.length ? monthsOf(range, dates) : [],
    breakdowns: detectBreakdowns(rows.map((r) => r.data)),
    amount: detectAmount(rows, range),
    highlights: moduleHighlights(mod, rows, range, cov),
  };
}

/** One analysis per catalog module that returned data on the last sync. */
export async function computeCatalogAnalyses(customerId: string, range: DateRange): Promise<ModuleAnalysis[]> {
  const coverage = await loadCoverage(customerId);
  const out: ModuleAnalysis[] = [];
  for (const mod of CATALOG) {
    const cov = coverage.get(mod.key);
    if (!cov || cov.status !== "ok") continue;
    const records = mod.countOnly ? [] : await prisma.zuperRecord.findMany({ where: { customerId, module: mod.key }, select: { data: true, recordCreatedAt: true } });
    out.push(analyzeModule(mod, records.map((r) => ({ data: r.data as CompactRecord, at: r.recordCreatedAt })), range, cov));
  }
  return out;
}

// ---- Jobs: service delivery (from Job.extra + catalog time logs) -------------------------------

export interface JobServiceDelivery {
  jobsInPeriod: number;
  /** False until a sync with the full job payload (Job.extra) has run. */
  extraSynced: boolean;
  /** Deadline field used for on-time, e.g. "scheduled_end_time" or "due_date"; null if jobs carry none. */
  deadlineField: string | null;
  onTime: { eligible: number; onTime: number; late: number; overdueOpen: number } | null;
  onTimeMonthly: { label: string; onTime: number; late: number }[];
  /** Completed jobs with an invoice linked on the job; null if the job payload has no invoice field. */
  invoicing: { completed: number; invoiced: number; field: string } | null;
  rating: { field: string; average: number; rated: number } | null;
  jobTypes: Breakdown | null;
  priorities: { name: string; count: number }[];
  multiTechShare: number | null;
  unscheduledBacklog: number | null;
  timeOnSite: {
    hours: number;
    jobsWithTime: number;
    avgHoursPerJob: number;
    byCategory: { name: string; avgHours: number; jobs: number }[];
    byUser: { name: string; hours: number }[];
  } | null;
}

export async function computeJobServiceDelivery(customerId: string, range: DateRange): Promise<JobServiceDelivery> {
  const [jobs, timelogs, unscheduled] = await Promise.all([
    prisma.job.findMany({
      where: { customerId, createdAt: { gte: range.start, lte: range.end } },
      select: { zuperJobId: true, status: true, serviceType: true, priority: true, completedAt: true, scheduledAt: true, extra: true },
    }),
    prisma.zuperRecord.findMany({ where: { customerId, module: "job_timelogs", recordCreatedAt: { gte: range.start, lte: range.end } }, select: { data: true } }),
    prisma.moduleCoverage.findUnique({ where: { customerId_module: { customerId, module: "unscheduled_jobs" } } }),
  ]);
  const extras = jobs.map((j) => (j.extra ?? {}) as CompactRecord);
  const has = (field: string) => extras.some((e) => e[field] != null && e[field] !== "");

  // On-time completion (SPEC §14.4): eligible = not-cancelled jobs whose deadline falls in the period.
  const deadlineField = ["scheduled_end_time", "due_date", "scheduled_end_date"].find(has) ?? null;
  let onTime: JobServiceDelivery["onTime"] = null;
  const monthly = new Map<string, { onTime: number; late: number; sort: number }>();
  if (deadlineField) {
    const now = new Date();
    const o = { eligible: 0, onTime: 0, late: 0, overdueOpen: 0 };
    jobs.forEach((j, idx) => {
      const deadline = date(extras[idx][deadlineField]);
      if (!deadline || deadline < range.start || deadline > range.end || j.status === "cancelled") return;
      const endOfDay = new Date(Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth(), deadline.getUTCDate() + 1));
      const key = `${MONTHS[deadline.getUTCMonth()]} ${String(deadline.getUTCFullYear()).slice(2)}`;
      const m = monthly.get(key) ?? { onTime: 0, late: 0, sort: deadline.getUTCFullYear() * 12 + deadline.getUTCMonth() };
      if (j.status === "completed" && j.completedAt) {
        o.eligible += 1;
        if (j.completedAt < endOfDay) {
          o.onTime += 1;
          m.onTime += 1;
        } else {
          o.late += 1;
          m.late += 1;
        }
      } else if (endOfDay < now) {
        o.eligible += 1;
        o.overdueOpen += 1;
        m.late += 1;
      }
      monthly.set(key, m);
    });
    onTime = o.eligible ? o : null;
  }

  // Billing follow-through: completed jobs with an invoice attached on the job record.
  const invoiceField = ["invoice.invoice_uid", "invoice.length", "invoices.length", "invoice_uid"].find(has) ?? null;
  let invoicing: JobServiceDelivery["invoicing"] = null;
  if (invoiceField) {
    const completedIdx = jobs.map((j, i) => (j.status === "completed" ? i : -1)).filter((i) => i >= 0);
    const invoiced = completedIdx.filter((i) => {
      const v = extras[i][invoiceField];
      return typeof v === "number" ? v > 0 : v != null && v !== "";
    }).length;
    invoicing = { completed: completedIdx.length, invoiced, field: invoiceField };
  }

  const ratingField = [...new Set(extras.flatMap((e) => Object.keys(e)))].find((k) => /rating/i.test(k) && extras.some((e) => typeof e[k] === "number" && (e[k] as number) > 0 && (e[k] as number) <= 5)) ?? null;
  let rating: JobServiceDelivery["rating"] = null;
  if (ratingField) {
    const vals = extras.map((e) => e[ratingField]).filter((v): v is number => typeof v === "number" && v > 0 && v <= 5);
    rating = { field: ratingField, average: vals.reduce((s, v) => s + v, 0) / vals.length, rated: vals.length };
  }

  const typeBreakdowns = detectBreakdowns(extras.map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => /job_type|work_type|source/i.test(k)))), 1);
  const pr = new Map<string, number>();
  for (const j of jobs) if (j.priority) pr.set(j.priority, (pr.get(j.priority) ?? 0) + 1);
  const assignedCounts = extras.map((e) => num(e["assigned_to.length"])).filter((v): v is number => v != null);

  let timeOnSite: JobServiceDelivery["timeOnSite"] = null;
  if (timelogs.length) {
    const jobCat = new Map(jobs.map((j) => [j.zuperJobId, j.serviceType ?? "Uncategorized"]));
    const perJob = new Map<string, number>();
    const perUser = new Map<string, number>();
    let ms = 0;
    for (const t of timelogs) {
      const d = t.data as CompactRecord;
      const a = date(d.clock_in_time);
      const b = date(d.clock_out_time);
      if (!a || !b || b <= a) continue;
      const dur = b.getTime() - a.getTime();
      ms += dur;
      const job = d["job.job_uid"] ? String(d["job.job_uid"]) : null;
      if (job) perJob.set(job, (perJob.get(job) ?? 0) + dur);
      const user = String(d["user.first_name"] ?? "") + (d["user.last_name"] ? ` ${d["user.last_name"]}` : "") || String(d["user.user_uid"] ?? "Unknown");
      perUser.set(user.trim() || "Unknown", (perUser.get(user.trim() || "Unknown") ?? 0) + dur);
    }
    const cat = new Map<string, { ms: number; jobs: number }>();
    for (const [job, dur] of perJob) {
      const c = jobCat.get(job);
      if (!c) continue;
      const e = cat.get(c) ?? { ms: 0, jobs: 0 };
      e.ms += dur;
      e.jobs += 1;
      cat.set(c, e);
    }
    timeOnSite = {
      hours: ms / 36e5,
      jobsWithTime: perJob.size,
      avgHoursPerJob: perJob.size ? ms / 36e5 / perJob.size : 0,
      byCategory: [...cat.entries()].map(([name, v]) => ({ name, avgHours: v.ms / 36e5 / v.jobs, jobs: v.jobs })).filter((c) => c.jobs >= 3).sort((a, b) => b.jobs - a.jobs).slice(0, 8),
      byUser: [...perUser.entries()].map(([name, v]) => ({ name, hours: v / 36e5 })).sort((a, b) => b.hours - a.hours).slice(0, 10),
    };
  }

  return {
    jobsInPeriod: jobs.length,
    extraSynced: jobs.some((j) => j.extra != null),
    deadlineField,
    onTime,
    onTimeMonthly: [...monthly.entries()].sort((a, b) => a[1].sort - b[1].sort).slice(-12).map(([label, v]) => ({ label, onTime: v.onTime, late: v.late })),
    invoicing,
    rating,
    jobTypes: typeBreakdowns[0] ?? null,
    priorities: [...pr.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    multiTechShare: assignedCounts.length ? assignedCounts.filter((c) => c > 1).length / assignedCounts.length : null,
    unscheduledBacklog: unscheduled?.status === "ok" ? unscheduled.recordCount : null,
    timeOnSite,
  };
}

// ---- Customer Portal & Zuper Pay ---------------------------------------------------------------

export interface PortalAndPay {
  /** False until a sync that pulls the catalog modules has run for this customer. */
  catalogSynced: boolean;
  portalOrgs: { enabled: number; total: number } | null;
  portalPayments: { count: number; amount: number } | null;
  paymentSources: { name: string; count: number; amount: number }[];
  online: { amount: number; total: number };
  paymentRequests: { count: number; inPeriod: number; amount: number | null; statuses: { name: string; count: number }[] } | null;
  portalRequests: number | null;
}

export async function computePortalAndPay(customerId: string, range: DateRange): Promise<PortalAndPay> {
  const [payments, orgs, requests, payReqs, coverageCount] = await Promise.all([
    prisma.payment.findMany({ where: { customerId, paidAt: { gte: range.start, lte: range.end } }, select: { amount: true, source: true, paymentModeType: true } }),
    prisma.zuperRecord.findMany({ where: { customerId, module: "organizations_portal" }, select: { data: true } }),
    prisma.zuperRecord.findMany({ where: { customerId, module: "requests" }, select: { data: true } }),
    prisma.zuperRecord.findMany({ where: { customerId, module: "payment_requests" }, select: { data: true, recordCreatedAt: true } }),
    prisma.moduleCoverage.count({ where: { customerId, module: "payment_requests" } }),
  ]);
  const sources = new Map<string, { count: number; amount: number }>();
  let online = 0;
  let total = 0;
  for (const p of payments) {
    const amt = Number(p.amount);
    total += amt;
    if (p.paymentModeType === "ONLINE") online += amt;
    if (!p.source) continue;
    const s = sources.get(p.source) ?? { count: 0, amount: 0 };
    s.count += 1;
    s.amount += amt;
    sources.set(p.source, s);
  }
  const portal = [...sources.entries()].filter(([k]) => /portal/i.test(k));
  const reqRows = requests.map((r) => r.data as CompactRecord);
  const portalReqField = reqRows.length ? Object.keys(reqRows[0]).find((k) => /source|created_by|channel/i.test(k)) : undefined;
  const prRows = payReqs.map((r) => ({ data: r.data as CompactRecord, at: r.recordCreatedAt }));
  const prStatus = detectBreakdowns(prRows.map((r) => r.data), 1)[0];
  const prAmount = detectAmount(prRows, range);
  return {
    catalogSynced: coverageCount > 0,
    portalOrgs: orgs.length ? { enabled: orgs.filter((o) => truthy((o.data as CompactRecord).is_portal_enabled)).length, total: orgs.length } : null,
    portalPayments: sources.size ? { count: portal.reduce((s, [, v]) => s + v.count, 0), amount: portal.reduce((s, [, v]) => s + v.amount, 0) } : null,
    paymentSources: [...sources.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 6),
    online: { amount: online, total },
    paymentRequests: prRows.length
      ? {
          count: prRows.length,
          inPeriod: prRows.filter((r) => r.at && r.at >= range.start && r.at <= range.end).length,
          amount: prAmount ? prAmount.total : null,
          statuses: prStatus?.values ?? [],
        }
      : null,
    portalRequests: portalReqField ? reqRows.filter((r) => /portal/i.test(String(r[portalReqField] ?? ""))).length : null,
  };
}
