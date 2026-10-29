import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ZuperApiError, ZuperClient } from "./client";
import { compactRecord, fieldStats, type CompactRecord } from "./compact";
import type { DateRange } from "./modules";

// ---------------------------------------------------------------------------
// "Pull everything": every list endpoint in Zuper's public API reference
// (developers.zuper.co, catalogued 2026-09-23) that has no dedicated table.
// Records are stored compacted in ZuperRecord; what each endpoint returned —
// or why it didn't — is stored in ModuleCoverage and shown on the deck's data
// coverage slides. Endpoint shapes beyond the path are unverified for most of
// these, so every fetch is defensive: a 4xx/5xx is recorded, never fatal.
// ---------------------------------------------------------------------------

export type ProductArea =
  | "Jobs & scheduling"
  | "Customers & portal"
  | "Assets & contracts"
  | "Sales & proposals"
  | "Billing & Zuper Pay"
  | "Inventory & purchasing"
  | "Team & time"
  | "Zuper Connect & CSR Agent"
  | "Automation & integrations";

type Params = Record<string, string | number | undefined>;

export interface CatalogModule {
  key: string;
  label: string;
  area: ProductArea;
  path: string;
  /** Zuper Connect lives on its own host ({dc}-connect.zuperpro.com). */
  host?: "main" | "connect";
  method?: "GET" | "POST";
  /** Query-param variants tried in order until one isn't rejected with a 4xx (first = preferred). */
  params?: (range: DateRange) => Params[];
  /** POST body builder (Connect endpoints). */
  body?: (range: DateRange, page: number, limit: number) => unknown;
  /** Only record Zuper's total_records (high-volume logs we don't need row by row). */
  countOnly?: boolean;
  maxRecords?: number;
  uidKeys?: string[];
  dateKeys?: string[];
  /** One line for notes: what the module is. */
  describe: string;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const periodDates = (r: DateRange) => ({ from: ymd(r.start), to: ymd(r.end) });

export const CATALOG: CatalogModule[] = [
  // ---- Jobs & scheduling -------------------------------------------------------------
  {
    key: "job_timelogs",
    label: "Job time logs",
    area: "Jobs & scheduling",
    path: "jobs/timelog_summary",
    params: (r) => [{ "filter.clocked_in_time_from": periodDates(r).from, "filter.clocked_in_time_to": periodDates(r).to }, {}],
    maxRecords: 10000,
    uidKeys: ["timelog_summary_uid"],
    dateKeys: ["clock_in_time", "created_at"],
    describe: "Technician clock-in/out on each job: time on site, hourly charge and amount earned.",
  },
  { key: "unscheduled_jobs", label: "Unscheduled jobs", area: "Jobs & scheduling", path: "jobs/unscheduled", countOnly: true, describe: "Jobs waiting to be scheduled (live backlog count)." },
  { key: "recurring_jobs", label: "Recurring job schedules", area: "Jobs & scheduling", path: "recurring_jobs", uidKeys: ["recurring_job_uid"], describe: "Recurring job series (maintenance plans, repeat visits) and their frequency." },
  { key: "job_categories", label: "Job categories", area: "Jobs & scheduling", path: "jobs/category", uidKeys: ["category_uid"], describe: "Configured job categories, estimated durations and status workflows." },
  {
    key: "appointments",
    label: "Appointments",
    area: "Jobs & scheduling",
    path: "appointments",
    uidKeys: ["appointment_uid"],
    dateKeys: ["scheduled_start_time", "created_at"],
    describe: "Scheduled appointments, their status and assignees.",
  },
  {
    key: "routes",
    label: "Routes",
    area: "Jobs & scheduling",
    path: "routes",
    params: (r) => [{ from_date: periodDates(r).from, to_date: periodDates(r).to }, {}],
    uidKeys: ["route_uid"],
    dateKeys: ["departure", "created_at"],
    describe: "Technician routes: jobs per route, distance, time and optimization.",
  },
  { key: "service_tasks", label: "Service tasks", area: "Jobs & scheduling", path: "service_tasks", uidKeys: ["service_task_uid"], describe: "Service tasks attached to jobs and other records." },
  { key: "notes", label: "Notes", area: "Jobs & scheduling", path: "notes", maxRecords: 15000, uidKeys: ["note_uid"], describe: "Notes logged on jobs, customers and other records." },
  { key: "attachments", label: "Attachments (photos & files)", area: "Jobs & scheduling", path: "attachments/group", countOnly: true, describe: "Photos and files uploaded to records." },

  // ---- Customers & portal --------------------------------------------------------------
  {
    key: "organizations_portal",
    label: "Organizations (portal access)",
    area: "Customers & portal",
    path: "organization",
    uidKeys: ["organization_uid"],
    describe: "B2B organizations, including whether Customer Portal access is enabled for each.",
  },

  // ---- Assets & contracts ----------------------------------------------------------------
  {
    key: "assets",
    label: "Assets",
    area: "Assets & contracts",
    path: "assets",
    params: () => [{ sort_by: "created_at", sort: "DESC", populate_inspection_form: "false" }, {}],
    uidKeys: ["asset_uid"],
    describe: "Customer equipment tracked in Zuper: status, category, warranty and service history.",
  },
  { key: "service_contracts", label: "Service contracts", area: "Assets & contracts", path: "service_contract", uidKeys: ["contract_uid"], describe: "Service agreements: value, term, approval status, activation and expiry." },
  { key: "requests", label: "Service requests", area: "Assets & contracts", path: "request", uidKeys: ["request_uid"], describe: "Inbound service requests (including from the Customer Portal) and their status." },

  // ---- Sales & proposals ----------------------------------------------------------------
  { key: "proposals", label: "Proposals", area: "Sales & proposals", path: "estimate", params: () => [{ "filter.is_proposal": "true" }], uidKeys: ["estimate_uid"], dateKeys: ["estimate_date", "created_at"], describe: "Quotes built as multi-option proposals (Good-Better-Best)." },
  { key: "packages", label: "Quote packages", area: "Sales & proposals", path: "invoice_estimate/package", uidKeys: ["package_uid"], describe: "Saved packages of line items used on quotes." },
  { key: "proposal_templates", label: "Proposal templates", area: "Sales & proposals", path: "invoice_estimate/proposal_template", uidKeys: ["template_uid"], describe: "Proposal templates configured for quoting." },

  // ---- Billing & Zuper Pay ---------------------------------------------------------------
  { key: "payment_requests", label: "Payment requests (Zuper Pay)", area: "Billing & Zuper Pay", path: "payments/payment_request", uidKeys: ["payment_request_uid"], describe: "Payment links / requests sent to customers through Zuper Pay." },
  { key: "credit_notes", label: "Credit notes", area: "Billing & Zuper Pay", path: "accounting/credit_notes", uidKeys: ["credit_note_uid"], dateKeys: ["credit_note_date", "created_at"], describe: "Credits issued to customers and how much is still unused." },
  { key: "credit_history", label: "Credit history", area: "Billing & Zuper Pay", path: "accounting/credit_history", uidKeys: ["credit_history_uid"], describe: "Credits applied to invoices and quotes." },

  // ---- Inventory & purchasing -------------------------------------------------------------
  { key: "purchase_orders", label: "Purchase orders", area: "Inventory & purchasing", path: "purchase_orders", uidKeys: ["purchase_order_uid"], dateKeys: ["purchase_order_date", "created_at"], describe: "Purchase / material orders to vendors." },
  { key: "service_orders", label: "Work orders", area: "Inventory & purchasing", path: "service_orders", uidKeys: ["service_order_uid", "purchase_order_uid"], describe: "Work orders issued to subcontractors." },
  { key: "vendors", label: "Vendors", area: "Inventory & purchasing", path: "vendors", uidKeys: ["vendor_uid"], describe: "Suppliers on the account." },
  { key: "subcontractors", label: "Subcontractors", area: "Inventory & purchasing", path: "subcontractors", uidKeys: ["vendor_uid"], describe: "Subcontractors on the account." },
  { key: "inventory_transactions", label: "Inventory transactions", area: "Inventory & purchasing", path: "product/transaction", maxRecords: 5000, uidKeys: ["transaction_uid"], describe: "Stock movements: received, consumed, transferred." },
  { key: "transfer_orders", label: "Transfer orders", area: "Inventory & purchasing", path: "products/transfer_orders", uidKeys: ["transfer_order_uid"], describe: "Stock transfers between locations." },
  { key: "product_groups", label: "Product groups", area: "Inventory & purchasing", path: "product/group", uidKeys: ["product_group_uid"], describe: "Grouped products/kits." },
  { key: "product_categories", label: "Product categories", area: "Inventory & purchasing", path: "products/category", uidKeys: ["category_uid"], describe: "Product catalog categories." },
  { key: "pricelists", label: "Price lists", area: "Inventory & purchasing", path: "products/pricelist", uidKeys: ["pricelist_uid"], describe: "Price lists configured for customers or segments." },

  // ---- Team & time ------------------------------------------------------------------------
  { key: "users", label: "Users & roles", area: "Team & time", path: "user/all", uidKeys: ["user_uid"], describe: "Every user on the account with role, designation and active status." },
  { key: "teams", label: "Teams", area: "Team & time", path: "teams/summary", uidKeys: ["team_uid"], describe: "Teams and their user counts." },
  {
    key: "user_timelogs",
    label: "User time (work, travel, break)",
    area: "Team & time",
    path: "users/timelog",
    // Returned 400 for both of the first two formats on a live account (2026-09-23); the later
    // variants are the other formats Zuper uses elsewhere. Failure is recorded on the coverage slide.
    params: (r) => [
      { "filter.from_date": periodDates(r).from, "filter.to_date": periodDates(r).to },
      { "filter.from_date": r.start.toISOString(), "filter.to_date": r.end.toISOString() },
      { "filter.from_date": `${periodDates(r).from} 00:00:00`, "filter.to_date": `${periodDates(r).to} 23:59:59` },
      { from_date: periodDates(r).from, to_date: periodDates(r).to },
    ],
    uidKeys: ["user_uid"],
    dateKeys: [],
    describe: "Per-user totals of work, travel and break time for the report period.",
  },
  { key: "timeoff", label: "Time off", area: "Team & time", path: "timesheets/request/timeoff", uidKeys: ["request_uid"], dateKeys: ["request_from", "created_at"], describe: "Time-off requests and approvals." },
  { key: "business_units", label: "Business units", area: "Team & time", path: "business_units", uidKeys: ["bu_uid"], describe: "Business units / trade types and their monthly goals." },
  { key: "commissions", label: "Commissions", area: "Team & time", path: "commissions", uidKeys: ["commission_uid"], dateKeys: ["commission_date", "created_at"], describe: "Sales and technician commissions and their payout status." },

  // ---- Zuper Connect & CSR Agent -------------------------------------------------------------
  {
    key: "connect_calls",
    label: "Calls (Zuper Connect / CSR Agent)",
    area: "Zuper Connect & CSR Agent",
    path: "telephony/calls",
    host: "connect",
    method: "POST",
    body: (_r, page, limit) => ({ filters: {}, page, limit }),
    maxRecords: 25000,
    uidKeys: ["call_uid"],
    describe: "Business calls through Zuper Connect, including calls handled by the AI CSR Agent: direction, status and duration.",
  },
  {
    key: "connect_sms",
    label: "Text conversations (Zuper Connect)",
    area: "Zuper Connect & CSR Agent",
    path: "telephony/message/conversations",
    host: "connect",
    method: "POST",
    body: (_r, page, limit) => ({ filters: {}, page, limit }),
    maxRecords: 15000,
    uidKeys: ["conversation_uid"],
    dateKeys: ["recent_conversation_at", "created_at"],
    describe: "SMS conversations with customers through Zuper Connect.",
  },

  // ---- Automation & integrations ------------------------------------------------------------------
  { key: "webhooks", label: "Webhooks", area: "Automation & integrations", path: "service/notifications/webhook", uidKeys: ["webhook_uid"], describe: "Webhooks sending Zuper events to other systems." },
  { key: "webhook_history", label: "Webhook deliveries", area: "Automation & integrations", path: "service/notifications/webhook_history", countOnly: true, describe: "Webhook deliveries (count)." },
];

/** Zuper products/metrics with no endpoint on the account API — listed on the coverage slides so absence isn't read as non-use. */
export const NOT_IN_API: { key: string; label: string; area: ProductArea; reason: string }[] = [
  { key: "report_builder", label: "Report Builder usage", area: "Automation & integrations", reason: "No API for saved reports, dashboards or exports — check in the account's Report Builder / Sense admin." },
  { key: "fleet", label: "Zuper Fleet (GPS)", area: "Jobs & scheduling", reason: "Vehicle tracking data isn't exposed on the account API." },
  { key: "instant_estimate", label: "Instant Estimate widget", area: "Sales & proposals", reason: "Widget leads aren't exposed separately; they appear as requests/quotes if enabled." },
  { key: "csr_agent_config", label: "CSR Agent settings & AI summaries", area: "Zuper Connect & CSR Agent", reason: "AI agent configuration and call summaries aren't exposed; only call records are." },
  { key: "portal_logins", label: "Customer Portal logins & views", area: "Customers & portal", reason: "Portal sessions aren't exposed; portal enablement, portal-sourced requests and payments are." },
  { key: "api_usage", label: "API calls, response times, storage", area: "Automation & integrations", reason: "Platform telemetry isn't available to the account's API key." },
  { key: "contracted_seats", label: "Contracted seats", area: "Team & time", reason: "A billing figure — take it from the contract." },
];

// ---- Runner -------------------------------------------------------------------------------------

function connectBaseUrl(apiBaseUrl: string): string {
  // https://us-east-1.zuperpro.com/api -> https://us-east-1-connect.zuperpro.com/api
  return apiBaseUrl.replace(/^https:\/\/([^.]+)\./, "https://$1-connect.");
}

function extractList(res: unknown): { items: Record<string, unknown>[]; total: number | null; totalPages: number | null } {
  const r = (res ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  let items: unknown = r.data;
  let meta: Record<string, unknown> = r;
  if (!Array.isArray(items) && items && typeof items === "object") {
    meta = { ...r, ...(items as Record<string, unknown>) };
    items = Object.values(items as Record<string, unknown>).find(Array.isArray) ?? [items];
  }
  if (!Array.isArray(items)) items = Array.isArray(res) ? res : [];
  const paging = (meta.paging ?? {}) as Record<string, unknown>;
  return {
    items: (items as unknown[]).filter((x): x is Record<string, unknown> => !!x && typeof x === "object"),
    total: num(meta.total_records ?? meta.total ?? paging.total),
    totalPages: num(meta.total_pages),
  };
}

function pickUid(rec: Record<string, unknown>, keys: string[] | undefined, fallback: string): string {
  for (const k of keys ?? []) if (rec[k] != null) return String(rec[k]);
  const anyUid = Object.entries(rec).find(([k, v]) => k.endsWith("_uid") && typeof v === "string");
  return anyUid ? String(anyUid[1]) : fallback;
}

function pickDate(rec: Record<string, unknown>, keys: string[] | undefined): Date | null {
  for (const k of [...(keys ?? []), "created_at"]) {
    const v = rec[k];
    if (typeof v === "string" || typeof v === "number") {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

export interface CatalogModuleResult {
  key: string;
  status: string;
  recordCount: number;
  message?: string;
}

const PAGE_SIZE = 200;
const DEFAULT_MAX = 5000;
const json = (v: unknown) => v as Prisma.InputJsonValue;

async function fetchModule(mod: CatalogModule, client: ZuperClient, range: DateRange, deadline: number) {
  const variants = mod.params?.(range) ?? [{}];
  let lastErr: unknown = null;
  for (const params of variants) {
    try {
      if (mod.countOnly) {
        const res = await client.getRaw(mod.path, { ...params, page: 1, count: 1, limit: 1 });
        const { total, items } = extractList(res);
        return { items: [] as Record<string, unknown>[], total: total ?? items.length, truncated: false, partialError: null as string | null };
      }
      const max = mod.maxRecords ?? DEFAULT_MAX;
      const items: Record<string, unknown>[] = [];
      let total: number | null = null;
      const fetchPage = (page: number) =>
        mod.method === "POST"
          ? client.postRaw(mod.path, mod.body?.(range, page, PAGE_SIZE) ?? { page, limit: PAGE_SIZE })
          : client.getRaw(mod.path, { ...params, page, count: PAGE_SIZE, limit: PAGE_SIZE });
      for (let page = 1; ; page++) {
        let res: unknown;
        try {
          res = await fetchPage(page);
        } catch (err) {
          // Deep pages sometimes 5xx on large accounts (seen on Connect calls): retry once, then keep
          // what already arrived rather than discarding the whole module.
          const serverSide = !(err instanceof ZuperApiError) || err.status >= 500;
          if (!serverSide) throw err;
          try {
            await new Promise((r) => setTimeout(r, 1500));
            res = await fetchPage(page);
          } catch (retryErr) {
            if (!items.length) throw retryErr;
            const why = retryErr instanceof ZuperApiError ? `HTTP ${retryErr.status}` : "error";
            return { items, total, truncated: true, partialError: `Stopped at page ${page} (${why}) — kept the first ${items.length.toLocaleString("en-US")} records` };
          }
        }
        const list = extractList(res);
        total ??= list.total;
        items.push(...list.items);
        const done = list.items.length < PAGE_SIZE || (list.totalPages != null && page >= list.totalPages) || (total != null && items.length >= total);
        if (done) return { items, total, truncated: false, partialError: null as string | null };
        if (items.length >= max || Date.now() > deadline) return { items: items.slice(0, max), total, truncated: true, partialError: null as string | null };
      }
    } catch (err) {
      lastErr = err;
      // Only try the next param variant when the request itself was rejected.
      if (!(err instanceof ZuperApiError) || err.status < 400 || err.status >= 500) break;
    }
  }
  throw lastErr;
}

/**
 * Syncs catalog modules starting at `startIndex` until done or `deadline` (epoch ms) passes.
 * Returns the index to resume from (null when every module has been attempted) — the sync
 * route calls this in a loop from the browser so no single request hits the function time limit.
 */
export async function runCatalogSync(
  customerId: string,
  apiKey: string,
  apiBaseUrl: string,
  range: DateRange,
  syncRunId: string,
  { startIndex = 0, deadline = Date.now() + 240_000 }: { startIndex?: number; deadline?: number } = {}
): Promise<{ nextIndex: number | null; results: CatalogModuleResult[] }> {
  const clients = { main: new ZuperClient(apiKey, apiBaseUrl), connect: new ZuperClient(apiKey, connectBaseUrl(apiBaseUrl)) };
  const results: CatalogModuleResult[] = [];

  if (startIndex === 0) {
    for (const n of NOT_IN_API) {
      await upsertCoverage(customerId, syncRunId, { module: n.key, label: n.label, endpoint: "—", status: "not_in_api", message: n.reason });
    }
  }

  for (let i = startIndex; i < CATALOG.length; i++) {
    if (Date.now() > deadline - 20_000) return { nextIndex: i, results };
    const mod = CATALOG[i];
    const client = clients[mod.host ?? "main"];
    const endpoint = `${mod.method ?? "GET"} ${mod.host === "connect" ? "connect:" : ""}/${mod.path}`;
    try {
      const { items, total, truncated, partialError } = await fetchModule(mod, client, range, deadline - 25_000);
      const compacted: { uid: string; data: CompactRecord; createdAt: Date | null }[] = items.map((raw, idx) => ({
        uid: pickUid(raw, mod.uidKeys, `row-${idx}`),
        data: compactRecord(raw),
        createdAt: pickDate(raw, mod.dateKeys),
      }));
      // De-duplicate on uid (some endpoints repeat records across pages).
      const unique = [...new Map(compacted.map((c) => [c.uid, c])).values()];
      await prisma.zuperRecord.deleteMany({ where: { customerId, module: mod.key } });
      for (let b = 0; b < unique.length; b += 500) {
        await prisma.zuperRecord.createMany({
          data: unique.slice(b, b + 500).map((c) => ({ customerId, module: mod.key, recordUid: c.uid, data: json(c.data), recordCreatedAt: c.createdAt, syncRunId })),
        });
      }
      const count = mod.countOnly ? (total ?? 0) : unique.length;
      await upsertCoverage(customerId, syncRunId, {
        module: mod.key,
        label: mod.label,
        endpoint,
        status: count > 0 ? "ok" : "empty",
        recordCount: count,
        totalRecords: total,
        truncated,
        fieldStats: mod.countOnly ? null : fieldStats(unique.map((c) => c.data)),
        message: partialError ?? (truncated ? `Capped at ${unique.length.toLocaleString("en-US")} of ${total?.toLocaleString("en-US") ?? "more"} records` : null),
      });
      results.push({ key: mod.key, status: count > 0 ? "ok" : "empty", recordCount: count });
    } catch (err) {
      const httpStatus = err instanceof ZuperApiError ? err.status : null;
      const status = httpStatus === 401 || httpStatus === 403 || httpStatus === 404 ? "not_available" : "error";
      const message =
        httpStatus === 403 || httpStatus === 401
          ? "Not enabled for this account, or the API key lacks access"
          : httpStatus === 404
            ? "Endpoint not found for this account"
            : err instanceof Error
              ? err.message.slice(0, 200)
              : String(err);
      await upsertCoverage(customerId, syncRunId, { module: mod.key, label: mod.label, endpoint, status, httpStatus, message });
      results.push({ key: mod.key, status, recordCount: 0, message });
    }
  }
  return { nextIndex: null, results };
}

export async function upsertCoverage(
  customerId: string,
  syncRunId: string,
  c: {
    module: string;
    label: string;
    endpoint: string;
    status: string;
    httpStatus?: number | null;
    recordCount?: number;
    totalRecords?: number | null;
    truncated?: boolean;
    fieldStats?: unknown;
    message?: string | null;
  }
) {
  const data = {
    label: c.label,
    endpoint: c.endpoint,
    status: c.status,
    httpStatus: c.httpStatus ?? null,
    recordCount: c.recordCount ?? 0,
    totalRecords: c.totalRecords ?? null,
    truncated: c.truncated ?? false,
    fieldStats: c.fieldStats == null ? undefined : json(c.fieldStats),
    message: c.message ?? null,
    fetchedAt: new Date(),
    syncRunId,
  };
  await prisma.moduleCoverage.upsert({
    where: { customerId_module: { customerId, module: c.module } },
    create: { customerId, module: c.module, ...data },
    update: data,
    select: { id: true }, // don't send the fieldStats JSON back
  });
}
