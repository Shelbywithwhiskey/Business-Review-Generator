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
  /** A few record names (for setup summaries). */
  names: string[];
  /** Every record shares one status (e.g. all DRAFT) — a sign the area isn't in real use. */
  singleStatus: { field: string; value: string } | null;
  /** Records created by a Zuper employee account (created_by email @zuper.co) — onboarding/setup data. */
  createdByZuper: number;
  calls?: CallSummary;
  timelogs?: TimelogSummary;
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

export interface CallSummary {
  inPeriod: number;
  inbound: number;
  inboundAnswered: number;
  inboundMissed: number;
  outbound: number;
  avgAnswerSec: number | null;
  avgTalkSec: number | null;
  recordedShare: number | null;
  ai: number;
  monthly: { label: string; count: number }[];
}

/** Verified against a live Connect account (2026-09-23): direction INCOMING | OUTGOING, status
 * COMPLETED | FORWARDED | MISSED | CANCELED | VOICEMAIL, call_metric.answered_at / time_to_answer (s),
 * duration (s), is_recorded. */
export function summarizeCalls(rows: { data: CompactRecord; at: Date | null }[], range: DateRange): CallSummary {
  const period = rows.filter((r) => r.at && r.at >= range.start && r.at <= range.end);
  const isIn = (r: CompactRecord) => /^in|incoming|inbound/i.test(String(r.direction ?? ""));
  const isOut = (r: CompactRecord) => /^out|outgoing|outbound/i.test(String(r.direction ?? ""));
  const answered = (r: CompactRecord) => r["call_metric.answered_at"] != null && r["call_metric.answered_at"] !== "";
  const missedStatus = (r: CompactRecord) => /miss|no.?answer|unanswer|abandon|voicemail/i.test(String(r.status ?? ""));
  const inbound = period.filter((r) => isIn(r.data));
  const answeredRows = period.filter((r) => answered(r.data));
  const answerSecs = answeredRows.map((r) => num(r.data["call_metric.time_to_answer"])).filter((v): v is number => v != null && v >= 0);
  const talk = answeredRows.map((r) => num(r.data.duration)).filter((v): v is number => v != null && v > 0);
  const recorded = period.filter((r) => r.data.is_recorded != null);
  return {
    inPeriod: period.length,
    inbound: inbound.length,
    inboundAnswered: inbound.filter((r) => answered(r.data)).length,
    inboundMissed: inbound.filter((r) => !answered(r.data) || missedStatus(r.data)).length,
    outbound: period.filter((r) => isOut(r.data)).length,
    avgAnswerSec: answerSecs.length ? answerSecs.reduce((s, v) => s + v, 0) / answerSecs.length : null,
    avgTalkSec: talk.length ? talk.reduce((s, v) => s + v, 0) / talk.length : null,
    recordedShare: recorded.length ? recorded.filter((r) => truthy(r.data.is_recorded)).length / recorded.length : null,
    ai: period.filter((r) => Object.entries(r.data).some(([k, v]) => /(^|_|\.)(ai|agent|bot|virtual|csr)(_|\.|$)/i.test(k) && (v === true || v === "true"))).length,
    monthly: monthsOf(range, period.map((r) => r.at!)),
  };
}

export interface TimelogSummary {
  entries: number;
  hours: number;
  longEntries: number;
  people: { name: string; hours: number; entries: number }[];
}

/** time_spent is minutes (verified: 4210 = clock_out − clock_in of 70.2 h). Job time logs carry no job id. */
export function summarizeTimelogs(data: CompactRecord[], range: DateRange): TimelogSummary {
  const people = new Map<string, { hours: number; entries: number }>();
  let hours = 0;
  let entries = 0;
  let longEntries = 0;
  for (const r of data) {
    const a = date(r.clock_in_time);
    if (!a || a < range.start || a > range.end) continue;
    const b = date(r.clock_out_time);
    const spent = num(r.time_spent);
    const h = spent != null && spent > 0 ? spent / 60 : b && b > a ? (b.getTime() - a.getTime()) / 36e5 : 0;
    entries += 1;
    hours += h;
    if (h > 12) longEntries += 1;
    const name = `${r["user.first_name"] ?? ""} ${r["user.last_name"] ?? ""}`.trim() || String(r["user.user_uid"] ?? "Unknown");
    const p = people.get(name) ?? { hours: 0, entries: 0 };
    p.hours += h;
    p.entries += 1;
    people.set(name, p);
  }
  return { entries, hours, longEntries, people: [...people.entries()].map(([name, v]) => ({ name, ...v })).sort((x, y) => y.hours - x.hours) };
}

function detectSingleStatus(rows: CompactRecord[]): { field: string; value: string } | null {
  if (rows.length < 3) return null;
  const keys = Object.keys(rows[0]).filter((k) => /status$/i.test(k) && !k.includes("."));
  for (const k of keys) {
    const values = new Set(rows.map((r) => r[k]).filter((v) => typeof v === "string" && v));
    if (values.size === 1 && rows.every((r) => typeof r[k] === "string")) return { field: k, value: String([...values][0]) };
  }
  return null;
}

/** Display names of a module's records (for setup/config summaries). */
export function recordNames(rows: CompactRecord[], max = 5): string[] {
  const names: string[] = [];
  for (const r of rows) {
    const key = Object.keys(r).find((k) => !k.includes(".") && /(_name|_title|^name|^title)$/i.test(k) && typeof r[k] === "string" && r[k]);
    if (key) names.push(String(r[key]));
    if (names.length >= max) break;
  }
  return names;
}

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
      const t = summarizeTimelogs(data, range);
      h.push({ label: "Hours logged on jobs", value: fmt(t.hours), definition: "Sum of time_spent (minutes) — or clock_out − clock_in where time_spent is blank — for time logs clocked in during the period." });
      h.push({ label: "Time log entries", value: fmt(t.entries), definition: "Job time logs clocked in during the period." });
      h.push({ label: "People logging time", value: fmt(t.people.length), definition: "Distinct user.user_uid across those time logs." });
      if (t.longEntries) h.push({ label: "Entries over 12 hours", value: fmt(t.longEntries), definition: "Single time logs longer than 12 hours — usually a missed clock-out.", alert: true });
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
      const c = summarizeCalls(rows, range);
      h.push({ label: "Calls in the period", value: fmt(c.inPeriod), definition: "Call records whose created_at falls in the period." });
      if (c.inbound) h.push({ label: "Inbound answer rate", value: pct(c.inboundAnswered / c.inbound), definition: "Incoming calls in the period with an answered time (call_metric.answered_at) ÷ all incoming calls.", alert: c.inboundAnswered / c.inbound < 0.85 });
      h.push({ label: "Missed / unanswered inbound", value: fmt(c.inboundMissed), definition: "Incoming calls in the period with no answered time, or status MISSED / VOICEMAIL — the calls CSR Agent is built to catch.", alert: c.inboundMissed > 0 });
      if (c.avgAnswerSec != null) h.push({ label: "Avg time to answer", value: `${c.avgAnswerSec.toFixed(0)} s`, definition: "Mean call_metric.time_to_answer (seconds) across answered calls in the period." });
      if (c.ai) h.push({ label: "Handled by AI / CSR Agent", value: fmt(c.ai), definition: "Calls carrying an AI/agent/bot flag or agent value." });
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
    names: recordNames(rows.map((r) => r.data)),
    singleStatus: detectSingleStatus(rows.map((r) => r.data)),
    createdByZuper: rows.filter((r) => /@zuper\.co$/i.test(String(r.data["created_by.email"] ?? ""))).length,
    calls: mod.key === "connect_calls" ? summarizeCalls(rows, range) : undefined,
    timelogs: mod.key === "job_timelogs" ? summarizeTimelogs(rows.map((r) => r.data), range) : undefined,
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
  /** On-time split by job category — categories behave very differently (a sales job stays open while the deal is worked). */
  onTimeByCategory: { name: string; eligible: number; onTime: number; late: number; overdueOpen: number; medianDaysLate: number | null }[];
  /** Completed jobs with an invoice linked on the job; null if the job payload has no invoice field. */
  invoicing: { completed: number; invoiced: number; field: string } | null;
  rating: { field: string; average: number; rated: number } | null;
  jobTypes: Breakdown | null;
  priorities: { name: string; count: number }[];
  multiTechShare: number | null;
  unscheduledBacklog: number | null;
  timeOnSite: TimelogSummary | null;
}

export async function computeJobServiceDelivery(customerId: string, range: DateRange): Promise<JobServiceDelivery> {
  const [jobs, timelogs, unscheduled] = await Promise.all([
    prisma.job.findMany({
      where: { customerId, createdAt: { gte: range.start, lte: range.end } },
      select: { zuperJobId: true, status: true, serviceType: true, priority: true, completedAt: true, scheduledAt: true, extra: true },
    }),
    // Filtered by clock-in date in summarizeTimelogs (created_at is the clock-out time).
    prisma.zuperRecord.findMany({ where: { customerId, module: "job_timelogs" }, select: { data: true } }),
    prisma.moduleCoverage.findUnique({ where: { customerId_module: { customerId, module: "unscheduled_jobs" } } }),
  ]);
  const extras = jobs.map((j) => (j.extra ?? {}) as CompactRecord);
  const has = (field: string) => extras.some((e) => e[field] != null && e[field] !== "");

  // On-time completion (SPEC §14.4): eligible = not-cancelled jobs whose deadline falls in the period.
  const deadlineField = ["scheduled_end_time", "due_date", "scheduled_end_date"].find(has) ?? null;
  let onTime: JobServiceDelivery["onTime"] = null;
  const monthly = new Map<string, { onTime: number; late: number; sort: number }>();
  const byCat = new Map<string, { eligible: number; onTime: number; late: number; overdueOpen: number; lateDays: number[] }>();
  if (deadlineField) {
    const now = new Date();
    const o = { eligible: 0, onTime: 0, late: 0, overdueOpen: 0 };
    jobs.forEach((j, idx) => {
      const deadline = date(extras[idx][deadlineField]);
      if (!deadline || deadline < range.start || deadline > range.end || j.status === "cancelled") return;
      const endOfDay = new Date(Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth(), deadline.getUTCDate() + 1));
      const key = `${MONTHS[deadline.getUTCMonth()]} ${String(deadline.getUTCFullYear()).slice(2)}`;
      const m = monthly.get(key) ?? { onTime: 0, late: 0, sort: deadline.getUTCFullYear() * 12 + deadline.getUTCMonth() };
      const cname = j.serviceType ?? "Uncategorized";
      const c = byCat.get(cname) ?? { eligible: 0, onTime: 0, late: 0, overdueOpen: 0, lateDays: [] };
      if (j.status === "completed" && j.completedAt) {
        o.eligible += 1;
        c.eligible += 1;
        if (j.completedAt < endOfDay) {
          o.onTime += 1;
          m.onTime += 1;
          c.onTime += 1;
        } else {
          o.late += 1;
          m.late += 1;
          c.late += 1;
          c.lateDays.push((j.completedAt.getTime() - deadline.getTime()) / DAY);
        }
      } else if (endOfDay < now) {
        o.eligible += 1;
        o.overdueOpen += 1;
        m.late += 1;
        c.eligible += 1;
        c.overdueOpen += 1;
      }
      monthly.set(key, m);
      byCat.set(cname, c);
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

  const t = summarizeTimelogs(timelogs.map((x) => x.data as CompactRecord), range);
  const timeOnSite: JobServiceDelivery["timeOnSite"] = t.entries ? t : null;

  return {
    jobsInPeriod: jobs.length,
    extraSynced: jobs.some((j) => j.extra != null),
    deadlineField,
    onTime,
    onTimeMonthly: [...monthly.entries()].sort((a, b) => a[1].sort - b[1].sort).slice(-12).map(([label, v]) => ({ label, onTime: v.onTime, late: v.late })),
    onTimeByCategory: [...byCat.entries()]
      .map(([name, v]) => {
        const s = [...v.lateDays].sort((a, b) => a - b);
        const medianDaysLate = s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
        return { name, eligible: v.eligible, onTime: v.onTime, late: v.late, overdueOpen: v.overdueOpen, medianDaysLate };
      })
      .filter((c) => c.eligible > 0)
      .sort((a, b) => b.eligible - a.eligible)
      .slice(0, 8),
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
