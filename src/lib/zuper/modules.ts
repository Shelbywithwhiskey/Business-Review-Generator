import { ZuperClient } from "./client";

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
}

// ---- Module adapters ----
// Endpoint paths and field names below were verified live against two real
// Zuper accounts (2026-09-22) — see project history. None of the list
// endpoints below actually filter by date server-side (confirmed by
// comparing total_records with/without every start/end param variant), so
// modules pull full history and lib/analytics.ts filters by period locally.

export const jobsModule = {
  key: "jobs" as const,
  async *fetch(client: ZuperClient) {
    for await (const page of client.paginate<Record<string, any>>("jobs")) {
      yield page.map(normalizeJob);
    }
  },
};

function normalizeJob(raw: Record<string, any>): NormalizedJob {
  const statusType = String(raw.current_job_status?.status_type ?? "").toUpperCase();
  const status =
    statusType === "COMPLETED"
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
  };
}

export const invoicesModule = {
  key: "invoices" as const,
  async *fetch(client: ZuperClient) {
    for await (const page of client.paginate<Record<string, any>>("invoice")) {
      yield page.map(normalizeInvoice);
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
  async *fetch(client: ZuperClient) {
    for await (const page of client.paginate<Record<string, any>>("estimate")) {
      yield page.map(normalizeQuote);
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
  async *fetch(client: ZuperClient) {
    const seen = new Set<string>();
    for await (const page of client.paginate<Record<string, any>>("team")) {
      const batch: NormalizedTechnician[] = [];
      for (const team of page) {
        for (const user of (team.users as Record<string, any>[] | undefined) ?? []) {
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
  async *fetch(client: ZuperClient) {
    for await (const page of client.paginate<Record<string, any>>("payments/transactions")) {
      yield page.map(normalizePayment);
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
    zuperInvoiceId: raw.invoice?.invoice_uid ?? null,
    // Zuper Pay itself isn't distinguishable in this response; ONLINE vs OFFLINE
    // payment_mode_type is the closest available proxy for "collected digitally".
    zuperPayUsed: paymentModeType === "ONLINE",
    paidAt: new Date(raw.payment_date_dt ?? raw.created_at),
  };
}

export const productsModule = {
  key: "products" as const,
  async *fetch(client: ZuperClient) {
    for await (const page of client.paginate<Record<string, any>>("product")) {
      yield page.map(normalizeProduct);
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
  async *fetch(client: ZuperClient) {
    for await (const page of client.paginate<Record<string, any>>("expenses")) {
      yield page.map(normalizeExpense);
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
  async *fetch(client: ZuperClient) {
    for await (const page of client.paginate<Record<string, any>>("customers")) {
      yield page.map(normalizeEndCustomer);
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
export type ModuleKey = (typeof MODULE_REGISTRY)[number]["key"];
