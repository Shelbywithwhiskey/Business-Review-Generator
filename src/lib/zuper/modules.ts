import { ZuperClient } from "./client";
import { compactRecord, type CompactRecord } from "./compact";
import { keepReal, type ExclusionLog } from "./testRecords";

export interface DateRange {
  start: Date;
  end: Date;
}

// ---- Normalized shapes (match Prisma models, minus id/customerId/syncRunId) ----

export interface NormalizedJob {
  zuperJobId: string;
  status: string;
  rawStatusName: string | null;
  serviceType: string | null;
  location: string | null;
  technicianId: string | null;
  endCustomerId: string | null;
  jobValue: number | null;
  createdAt: Date;
  completedAt: Date | null;
  scheduledAt: Date | null;
  priority: string | null;
  isRecurring: boolean;
  isScheduled: boolean;
  currentStatusType: string | null;
  organizationUid: string | null;
  statusHistory: JobStatusEntry[];
  /** Every other field, compacted — see lib/zuper/compact.ts. */
  extra: CompactRecord;
}

export interface JobStatusEntry {
  type: string;
  name: string;
  at: string;
  minutes: number | null;
}

export interface NormalizedOrganization {
  zuperOrganizationId: string;
  name: string;
  isActive: boolean;
  noOfCustomers: number;
  createdAt: Date;
}

export interface NormalizedProperty {
  zuperPropertyId: string;
  name: string;
  organizationUid: string | null;
  state: string | null;
  noOfJobs: number;
  isActive: boolean;
  createdAt: Date;
}

export interface NormalizedProject {
  zuperProjectId: string;
  name: string;
  status: string | null;
  createdAt: Date;
}

export interface NormalizedJobLineItem {
  position: number;
  productUid: string | null;
  name: string;
  productType: string;
  category: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  purchasePrice: number;
}

export interface NormalizedInvoice {
  zuperInvoiceId: string;
  invoiceNo: number | null;
  status: string;
  amount: number;
  amountPaid: number;
  isPaid: boolean;
  issuedAt: Date;
  dueAt: Date | null;
  paidAt: Date | null;
}

export interface NormalizedQuote {
  zuperQuoteId: string;
  quoteNo: number | null;
  status: string;
  value: number;
  discount: number;
  isConverted: boolean;
  isExpired: boolean;
  estimateAt: Date;
  expiryAt: Date | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
  convertedAt: Date | null;
}

export interface NormalizedTechnician {
  zuperUserId: string;
  name: string;
  email: string | null;
  designation: string | null;
  hourlyRate: number | null;
  isActive: boolean;
  licenseType: string | null;
  lastLoginAt: Date | null;
}

export interface NormalizedPayment {
  zuperPaymentId: string;
  amount: number;
  currency: string | null;
  paymentModeName: string | null;
  paymentModeType: string | null;
  actionModule: string | null;
  status: string | null;
  source: string | null;
  paymentType: string | null;
  zuperInvoiceId: string | null;
  zuperPayUsed: boolean;
  paidAt: Date;
}

export interface NormalizedProduct {
  zuperProductId: string;
  sku: string | null;
  name: string;
  category: string | null;
  price: number;
  purchasePrice: number;
  quantity: number;
  minQuantity: number;
  lowStock: boolean;
  isBillable: boolean;
}

/** Field names here are UNVERIFIED — both sandbox accounts probed had zero expense
 * records, so the shape of a populated /expenses item could not be confirmed. */
export interface NormalizedExpense {
  zuperExpenseId: string;
  amount: number;
  isBillable: boolean;
  category: string | null;
  description: string | null;
  incurredAt: Date;
}

export interface NormalizedTimesheetEvent {
  zuperTimesheetId: string;
  zuperUserId: string;
  userName: string | null;
  typeOfCheck: string;
  checkedAt: Date;
}

export interface NormalizedEndCustomer {
  zuperCustomerId: string;
  name: string;
  isActive: boolean;
  noOfJobs: number;
  ltv: number;
  receivables: number;
  credits: number;
  tags: string[];
  category: string | null;
  organizationUid: string | null;
  createdInZuperAt: Date | null;
}

export interface NormalizedWorkflow {
  zuperWorkflowId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isAiGenerated: boolean;
  isPublished: boolean;
  lastPublishedAt: Date | null;
  needsAttention: boolean;
  triggerName: string | null;
  triggerKey: string | null;
  triggerModule: string | null;
  stepCount: number;
  actionKeys: string[];
  lastExecutionStatus: string | null;
  lastExecutionTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---- Module adapters ----
// Endpoint paths and field names below were verified live against two real
// Zuper accounts (2026-09-22) — see project history. None of the list
// endpoints below actually filter by date server-side (confirmed by
// comparing total_records with/without every start/end param variant), so
// modules pull full history and lib/analytics.ts filters by period locally.
// Given an ExclusionLog, each module drops test/setup records (see testRecords.ts).

export const jobsModule = {
  key: "jobs" as const,
  async *fetch(client: ZuperClient, log?: ExclusionLog) {
    for await (const page of client.paginate<Record<string, any>>("jobs")) {
      yield keepReal(page, "jobs", log, (raw) => raw.job_uid).map((raw) => ({ job: normalizeJob(raw), lineItems: normalizeJobLineItems(raw) }));
    }
  },
};

/** The job's inline `products` array — product_type is PARTS | PRODUCT | SERVICE. */
function normalizeJobLineItems(raw: Record<string, any>): NormalizedJobLineItem[] {
  const items = (raw.products as Record<string, any>[] | undefined) ?? [];
  return items.map((item, position) => {
    const quantity = Number(item.quantity ?? 0);
    const unitPrice = Number(item.price ?? 0);
    const category = item.product_category;
    return {
      position,
      productUid: item.product_uid ?? null,
      name: item.product_name || "Unnamed item",
      productType: String(item.product_type ?? "UNKNOWN").toUpperCase(),
      category: typeof category === "string" ? category || null : (category?.category_name ?? null),
      quantity,
      unitPrice,
      total: item.total != null ? Number(item.total) : quantity * unitPrice,
      purchasePrice: Number(item.purchase_price ?? 0),
    };
  });
}

function normalizeJob(raw: Record<string, any>): NormalizedJob {
  const statusType = String(raw.current_job_status?.status_type ?? "").toUpperCase();
  // CLOSED is Zuper's post-completion state (verified 2026-09-23: NEW > SCHEDULED > COMPLETED > CLOSED) — done, not open.
  const status =
    statusType === "COMPLETED" || statusType === "CLOSED"
      ? "completed"
      : statusType === "CANCELLED" || statusType === "DECLINED"
        ? "cancelled"
        : statusType === "STARTED" || statusType === "ON_MY_WAY"
          ? "in_progress"
          : "open";

  const completedHistoryEntry = (raw.job_status as Record<string, any>[] | undefined)?.find(
    (s) => String(s.status_type ?? "").toUpperCase() === "COMPLETED"
  );

  const primaryAssignee =
    (raw.assigned_to as Record<string, any>[] | undefined)?.find((a) => a.is_primary) ?? raw.assigned_to?.[0];

  return {
    zuperJobId: String(raw.job_uid),
    status,
    rawStatusName: raw.current_job_status?.status_name ?? null,
    serviceType: raw.job_category?.category_name ?? null,
    location: raw.customer_address?.city ?? null,
    technicianId: primaryAssignee?.user?.user_uid ?? null,
    endCustomerId: raw.customer?.customer_uid ?? null,
    jobValue: raw.job_total != null ? Number(raw.job_total) : null,
    createdAt: new Date(raw.created_at),
    completedAt: completedHistoryEntry ? new Date(completedHistoryEntry.created_at) : null,
    scheduledAt: raw.due_date ? new Date(raw.due_date) : null,
    priority: raw.job_priority ?? null,
    isRecurring: Boolean(raw.is_recurrence),
    isScheduled: Boolean(raw.is_scheduled),
    currentStatusType: statusType || null,
    organizationUid: raw.organization?.organization_uid ?? null,
    statusHistory: ((raw.job_status as Record<string, any>[] | undefined) ?? []).map((s) => ({
      type: String(s.status_type ?? "UNKNOWN").toUpperCase(),
      name: s.status_name ?? "Unknown",
      at: s.created_at,
      minutes: typeof s.time_on_status === "number" ? s.time_on_status : null,
    })),
    // Already captured above (status history, line items, assignees) — leave them out of `extra`.
    extra: compactRecord(Object.fromEntries(Object.entries(raw).filter(([k]) => !["job_status", "products", "custom_fields_meta"].includes(k)))),
  };
}

export const organizationsModule = {
  key: "organizations" as const,
  async *fetch(client: ZuperClient, log?: ExclusionLog) {
    for await (const page of client.paginate<Record<string, any>>("organization")) {
      yield keepReal(page, "organizations", log, (raw) => raw.organization_uid).map(
        (raw): NormalizedOrganization => ({
          zuperOrganizationId: String(raw.organization_uid),
          name: raw.organization_name ?? "Unnamed organization",
          isActive: raw.is_active !== false,
          noOfCustomers: Number(raw.no_of_customers ?? 0),
          createdAt: new Date(raw.created_at),
        })
      );
    }
  },
};

export const propertiesModule = {
  key: "properties" as const,
  async *fetch(client: ZuperClient, log?: ExclusionLog) {
    for await (const page of client.paginate<Record<string, any>>("property")) {
      yield keepReal(page, "properties", log, (raw) => raw.property_uid).map(
        (raw): NormalizedProperty => ({
          zuperPropertyId: String(raw.property_uid),
          name: raw.property_name ?? "Unnamed property",
          organizationUid: raw.property_organization?.organization_uid ?? null,
          state: raw.property_address?.state || null,
          noOfJobs: Number(raw.no_of_jobs ?? 0),
          isActive: raw.is_active !== false,
          createdAt: new Date(raw.created_at),
        })
      );
    }
  },
};

/** Verified 2026-09-23 (Xterior): project_status is the status *history* array
 * [{project_status_name, project_status_type, created_at, ...}]; project_current_status
 * holds the current one when present. */
export const projectsModule = {
  key: "projects" as const,
  async *fetch(client: ZuperClient, log?: ExclusionLog) {
    for await (const page of client.paginate<Record<string, any>>("projects")) {
      yield keepReal(page, "projects", log, (raw) => raw.project_uid ?? raw.id).map((raw): NormalizedProject => {
        const history = Array.isArray(raw.project_status) ? (raw.project_status as Record<string, any>[]) : [];
        const current = raw.project_current_status ?? history[history.length - 1];
        const status = typeof current === "string" ? current : (current?.project_status_name ?? current?.status_name ?? null);
        return {
          zuperProjectId: String(raw.project_uid ?? raw.id),
          name: raw.project_name ?? raw.project_title ?? raw.name ?? "Unnamed project",
          status: typeof status === "string" ? status : null,
          createdAt: new Date(raw.created_at ?? raw.updated_at ?? Date.now()),
        };
      });
    }
  },
};

export const invoicesModule = {
  key: "invoices" as const,
  async *fetch(client: ZuperClient, log?: ExclusionLog) {
    for await (const page of client.paginate<Record<string, any>>("invoice")) {
      yield keepReal(page, "invoices", log, (raw) => raw.invoice_uid).map(normalizeInvoice);
    }
  },
};

function normalizeInvoice(raw: Record<string, any>): NormalizedInvoice {
  return {
    zuperInvoiceId: String(raw.invoice_uid),
    invoiceNo: raw.invoice_no != null ? Number(raw.invoice_no) : null,
    status: String(raw.invoice_status ?? "unknown").toLowerCase(),
    amount: Number(raw.total ?? 0),
    amountPaid: Number(raw.amount_paid ?? 0),
    isPaid: Boolean(raw.is_paid),
    issuedAt: new Date(raw.invoice_date),
    dueAt: raw.due_date ? new Date(raw.due_date) : null,
    paidAt: raw.paid_date ? new Date(raw.paid_date) : null,
  };
}

/** Zuper calls these "estimates" in the API; the product UI shows them as Quotes/Proposals. */
export const quotesModule = {
  key: "quotes" as const,
  async *fetch(client: ZuperClient, log?: ExclusionLog) {
    for await (const page of client.paginate<Record<string, any>>("estimate")) {
      yield keepReal(page, "quotes", log, (raw) => raw.estimate_uid).map(normalizeQuote);
    }
  },
};

function normalizeQuote(raw: Record<string, any>): NormalizedQuote {
  return {
    zuperQuoteId: String(raw.estimate_uid),
    quoteNo: raw.estimate_no != null ? Number(raw.estimate_no) : null,
    status: String(raw.estimate_status ?? "unknown").toLowerCase(),
    value: Number(raw.total ?? 0),
    discount: Number(raw.total_discount ?? 0),
    isConverted: Boolean(raw.is_converted),
    isExpired: Boolean(raw.is_expired),
    estimateAt: new Date(raw.estimate_date),
    expiryAt: raw.expiry_date ? new Date(raw.expiry_date) : null,
    sentAt: raw.sent_date ? new Date(raw.sent_date) : null,
    acceptedAt: raw.accepted_date ? new Date(raw.accepted_date) : null,
    convertedAt: raw.converted_date ? new Date(raw.converted_date) : null,
  };
}

/** There is no standalone technician/user-list endpoint — real identity (designation,
 * hourly rate) only comes back nested inside GET /team. Users are deduped by user_uid
 * across every team the account has. */
export const teamsModule = {
  key: "teams" as const,
  async *fetch(client: ZuperClient, log?: ExclusionLog) {
    const seen = new Set<string>();
    for await (const page of client.paginate<Record<string, any>>("team")) {
      const batch: NormalizedTechnician[] = [];
      for (const team of page) {
        // Zuper staff logins (onboarding/support) aren't the customer's seats.
        for (const user of keepReal((team.users as Record<string, any>[] | undefined) ?? [], "teams", log, (u) => u.user_uid, { ownEmail: true })) {
          const uid = String(user.user_uid);
          if (seen.has(uid)) continue;
          seen.add(uid);
          batch.push(normalizeTechnician(user));
        }
      }
      if (batch.length > 0) yield batch;
    }
  },
};

function normalizeTechnician(raw: Record<string, any>): NormalizedTechnician {
  return {
    zuperUserId: String(raw.user_uid),
    name: `${raw.first_name ?? ""} ${raw.last_name ?? ""}`.trim() || raw.email || "Unknown",
    email: raw.email ?? null,
    designation: raw.designation ?? raw.role?.role_name ?? null,
    hourlyRate: raw.hourly_labor_charge != null ? Number(raw.hourly_labor_charge) : null,
    isActive: raw.is_active !== false,
    licenseType: raw.license_type ?? null,
    lastLoginAt: raw.last_login_at ? new Date(raw.last_login_at) : null,
  };
}

export const paymentsModule = {
  key: "payments" as const,
  async *fetch(client: ZuperClient, log?: ExclusionLog) {
    for await (const page of client.paginate<Record<string, any>>("payments/transactions")) {
      yield keepReal(page, "payments", log, (raw) => raw.payment_transaction_uid).map(normalizePayment);
    }
  },
};

function normalizePayment(raw: Record<string, any>): NormalizedPayment {
  const paymentModeType = raw.payment_mode?.payment_mode_type ?? null;
  return {
    zuperPaymentId: String(raw.payment_transaction_uid),
    amount: Number(raw.amount ?? 0),
    currency: raw.currency ?? null,
    paymentModeName: raw.payment_mode?.payment_mode_name ?? null,
    paymentModeType,
    actionModule: raw.action_module ?? null,
    status: raw.status ?? null,
    source: typeof raw.source === "string" ? raw.source : (raw.source?.source_name ?? null),
    paymentType: typeof raw.type === "string" ? raw.type : null,
    zuperInvoiceId: raw.invoice?.invoice_uid ?? null,
    // Zuper Pay itself isn't distinguishable in this response; ONLINE vs OFFLINE
    // payment_mode_type is the closest available proxy for "collected digitally".
    zuperPayUsed: paymentModeType === "ONLINE",
    paidAt: new Date(raw.payment_date_dt ?? raw.created_at),
  };
}

export const productsModule = {
  key: "products" as const,
  async *fetch(client: ZuperClient, log?: ExclusionLog) {
    for await (const page of client.paginate<Record<string, any>>("product")) {
      yield keepReal(page, "products", log, (raw) => raw.product_uid).map(normalizeProduct);
    }
  },
};

function normalizeProduct(raw: Record<string, any>): NormalizedProduct {
  return {
    zuperProductId: String(raw.product_uid),
    sku: raw.product_id ?? null,
    name: raw.product_name ?? "Unnamed product",
    category: raw.product_category?.category_name ?? null,
    price: Number(raw.price ?? 0),
    purchasePrice: Number(raw.purchase_price ?? 0),
    quantity: Number(raw.quantity ?? 0),
    minQuantity: Number(raw.min_quantity ?? 0),
    lowStock: Boolean(raw.low_stock),
    isBillable: raw.is_billable !== false,
  };
}

/** UNVERIFIED: both sandbox accounts had zero expense records, so this field mapping
 * is best-effort from common Zuper conventions, not a confirmed live response. */
export const expensesModule = {
  key: "expenses" as const,
  async *fetch(client: ZuperClient, log?: ExclusionLog) {
    for await (const page of client.paginate<Record<string, any>>("expenses")) {
      yield keepReal(page, "expenses", log, (raw) => raw.expense_uid ?? raw.id).map(normalizeExpense);
    }
  },
};

function normalizeExpense(raw: Record<string, any>): NormalizedExpense {
  return {
    zuperExpenseId: String(raw.expense_uid ?? raw.id),
    amount: Number(raw.amount ?? raw.total ?? 0),
    isBillable: Boolean(raw.is_billable ?? raw.billable),
    category: raw.category?.category_name ?? raw.category ?? null,
    description: raw.description ?? raw.remarks ?? null,
    incurredAt: new Date(raw.expense_date ?? raw.created_at ?? raw.incurred_at),
  };
}

/** GET /timesheets 400s without a date range ("Date Field is Mandatory"); unlike every
 * other module, this one may actually filter server-side — untested either way, so the
 * requested range is passed under every plausible param name. */
export const timesheetsModule = {
  key: "timesheets" as const,
  async *fetch(client: ZuperClient, range: DateRange) {
    const start = range.start.toISOString();
    const end = range.end.toISOString();
    for await (const page of client.paginateNested<Record<string, any>>("timesheets", "timesheets", {
      start_date: start,
      end_date: end,
      from_date: start,
      to_date: end,
      date: end,
    })) {
      yield page.map(normalizeTimesheetEvent);
    }
  },
};

function normalizeTimesheetEvent(raw: Record<string, any>): NormalizedTimesheetEvent {
  const user = raw.users ?? raw.user ?? {};
  return {
    zuperTimesheetId: String(raw.employee_timesheet_uid ?? raw.id),
    zuperUserId: String(user.user_uid),
    userName: `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || null,
    typeOfCheck: String(raw.type_of_check ?? "unknown"),
    checkedAt: new Date(raw.checked_time ?? raw.created_at),
  };
}

/** Zuper's own end-customer ledger — accounts.ltv/receivables/credits are Zuper-computed,
 * pulled as-is rather than re-derived. This is the tenant's own customer list, unrelated
 * to this app's Customer model (the CSM's client). */
export const endCustomersModule = {
  key: "endCustomers" as const,
  async *fetch(client: ZuperClient, log?: ExclusionLog) {
    for await (const page of client.paginate<Record<string, any>>("customers")) {
      yield keepReal(page, "endCustomers", log, (raw) => raw.customer_uid).map(normalizeEndCustomer);
    }
  },
};

function normalizeEndCustomer(raw: Record<string, any>): NormalizedEndCustomer {
  const name =
    `${raw.customer_first_name ?? ""} ${raw.customer_last_name ?? ""}`.trim() ||
    raw.customer_company_name ||
    "Unknown";
  return {
    zuperCustomerId: String(raw.customer_uid),
    name,
    isActive: raw.is_active !== false,
    noOfJobs: Number(raw.no_of_jobs ?? 0),
    ltv: Number(raw.accounts?.ltv ?? 0),
    receivables: Number(raw.accounts?.receivables ?? 0),
    credits: Number(raw.accounts?.credits ?? 0),
    tags: Array.isArray(raw.customer_tags) ? raw.customer_tags.map(String) : [],
    category: raw.customer_category?.category_name ?? null,
    organizationUid: raw.customer_organization?.organization_uid ?? null,
    createdInZuperAt: raw.created_at ? new Date(raw.created_at) : null,
  };
}

/** Runs against a Workflow Builder client (separate host — see ApiCredential.workflowBaseUrl), not the main API client.
 * The list omits the node graph, so each workflow's detail is fetched too (accounts have tens, not thousands). */
export const workflowsModule = {
  key: "workflows" as const,
  async *fetch(client: ZuperClient) {
    for await (const page of client.paginate<Record<string, any>>("workflows")) {
      const details = await Promise.all(
        page.map((raw) => client.get<Record<string, any>>(`workflows/${raw.workflow_uid}`).catch(() => null))
      );
      yield page.map((raw, i) => normalizeWorkflow(raw, details[i]));
    }
  },
};

function normalizeWorkflow(raw: Record<string, any>, detail: Record<string, any> | null): NormalizedWorkflow {
  // Published graph is what actually runs; fall back to the draft for never-published workflows.
  const liveNodes = Array.isArray(detail?.live_nodes) ? detail.live_nodes : [];
  const nodes: Record<string, any>[] = liveNodes.length ? liveNodes : Array.isArray(detail?.nodes) ? detail.nodes : [];
  const trigger = nodes.find((n) => n.action_type === "TRIGGER");
  const actions = nodes.filter((n) => n.action_type === "ACTION");

  return {
    zuperWorkflowId: String(raw.workflow_uid),
    name: raw.workflow_name ?? "Untitled workflow",
    description: raw.workflow_description || null,
    isActive: Boolean(raw.is_active),
    isAiGenerated: Boolean(raw.is_ai_generated),
    isPublished: Boolean(detail?.live_version),
    lastPublishedAt: detail?.last_published_date ? new Date(detail.last_published_date) : null,
    needsAttention: Boolean(raw.needs_attention),
    triggerName: trigger?.action_name ?? null,
    triggerKey: trigger?.action_key ?? null,
    triggerModule: trigger?.module || null,
    stepCount: actions.length,
    actionKeys: actions.map((n) => String(n.action_key ?? "unknown")),
    lastExecutionStatus: detail?.last_execution_status ?? null,
    lastExecutionTime: raw.last_execution_time ? new Date(raw.last_execution_time) : null,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  };
}

// ---- Workflow executions (aggregated, not stored per-run) ----
// GET /workflows/execution_history is what Workflow Builder's own Executions
// screen calls. Verified 2026-09-23 against a live account: accepts the API key;
// filter.workflow_uid / filter.status (COMPLETED | FAILED | SKIPPED) /
// filter.start_date + filter.end_date (YYYY-MM-DD, inclusive) narrow
// total_records exactly; limit goes up to 1000; filter.mode is ignored;
// history only reaches back ~2 months. So counts come from total_records
// (one cheap call per filter) rather than paging through every run.

export interface ExecutionSnapshot {
  retainedFrom: Date | null;
  countedFrom: Date;
  completed: number;
  failed: number;
  skipped: number;
  medianMs: number | null;
  p90Ms: number | null;
  perWorkflow: { workflowUid: string; name: string; completed: number; failed: number; skipped: number; medianMs: number | null }[];
  weekly: { weekStart: string; total: number; failed: number }[];
  topErrors: { message: string; count: number }[];
  errorSampleSize: number;
}

const EXEC_STATUSES = ["COMPLETED", "FAILED", "SKIPPED"] as const;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function percentile(sorted: number[], p: number): number | null {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;
}

export async function fetchExecutionSnapshot(
  client: ZuperClient,
  workflows: { workflowUid: string; name: string }[],
  range: DateRange
): Promise<ExecutionSnapshot> {
  type Envelope = { data?: Record<string, any>[]; total_records?: number };
  const history = (params: Record<string, string | number | undefined>) =>
    client.getRaw<Envelope>("workflows/execution_history", { page: 1, limit: 1, ...params });
  const count = async (params: Record<string, string | number | undefined>) => (await history(params)).total_records ?? 0;

  // Oldest retained execution = last record of the unfiltered, newest-first list.
  const all = await history({});
  const total = all.total_records ?? 0;
  const oldest = total ? (await history({ page: total })).data?.[0]?.created_at : null;
  const retainedFrom = oldest ? new Date(oldest) : null;
  const countedFrom = retainedFrom && retainedFrom > range.start ? retainedFrom : range.start;
  const window = { "filter.start_date": ymd(countedFrom), "filter.end_date": ymd(range.end) };

  const perWorkflow = [];
  for (const wf of workflows) {
    const [completed, failed, skipped] = await Promise.all(
      EXEC_STATUSES.map((status) => count({ ...window, "filter.workflow_uid": wf.workflowUid, "filter.status": status }))
    );
    let medianMs: number | null = null;
    if (completed > 0) {
      const sample = await history({ ...window, "filter.workflow_uid": wf.workflowUid, "filter.status": "COMPLETED", limit: 200 });
      const ms = (sample.data ?? []).map((e) => Number(e.execution_time_ms)).filter(Number.isFinite).sort((a, b) => a - b);
      medianMs = percentile(ms, 0.5);
    }
    perWorkflow.push({ ...wf, completed, failed, skipped, medianMs });
  }

  const [completed, failed, skipped] = await Promise.all(EXEC_STATUSES.map((status) => count({ ...window, "filter.status": status })));

  const weekly: ExecutionSnapshot["weekly"] = [];
  for (let start = new Date(countedFrom); start <= range.end; start = new Date(start.getTime() + 7 * 864e5)) {
    const end = new Date(Math.min(start.getTime() + 6 * 864e5, range.end.getTime()));
    const w = { "filter.start_date": ymd(start), "filter.end_date": ymd(end) };
    const [wTotal, wFailed] = await Promise.all([count(w), count({ ...w, "filter.status": "FAILED" })]);
    weekly.push({ weekStart: ymd(start), total: wTotal, failed: wFailed });
  }

  const failedSample = failed ? (await history({ ...window, "filter.status": "FAILED", limit: 1000 })).data ?? [] : [];
  const errorCounts = new Map<string, number>();
  for (const e of failedSample) {
    const message = String(e.error_message || e.error_code || "Unknown error").slice(0, 80);
    errorCounts.set(message, (errorCounts.get(message) ?? 0) + 1);
  }
  const okSample = completed ? (await history({ ...window, "filter.status": "COMPLETED", limit: 1000 })).data ?? [] : [];
  const ms = okSample.map((e) => Number(e.execution_time_ms)).filter(Number.isFinite).sort((a, b) => a - b);

  return {
    retainedFrom,
    countedFrom,
    completed,
    failed,
    skipped,
    medianMs: percentile(ms, 0.5),
    p90Ms: percentile(ms, 0.9),
    perWorkflow,
    weekly,
    topErrors: [...errorCounts.entries()].map(([message, n]) => ({ message, count: n })).sort((a, b) => b.count - a.count).slice(0, 5),
    errorSampleSize: failedSample.length,
  };
}

export const MODULE_REGISTRY = [
  jobsModule,
  invoicesModule,
  quotesModule,
  teamsModule,
  paymentsModule,
  productsModule,
  expensesModule,
  timesheetsModule,
  endCustomersModule,
];
export type ModuleKey =
  | (typeof MODULE_REGISTRY)[number]["key"]
  | "workflows"
  | "organizations"
  | "properties"
  | "projects"
  | "executions";
