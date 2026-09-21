import { ZuperClient } from "./client";

export interface DateRange {
  start: Date;
  end: Date;
}

// ---- Normalized shapes (match Prisma models, minus id/customerId/syncRunId) ----

export interface NormalizedJob {
  zuperJobId: string;
  status: string;
  serviceType: string | null;
  location: string | null;
  technicianId: string | null;
  jobValue: number | null;
  createdAt: Date;
  completedAt: Date | null;
  scheduledAt: Date | null;
}

export interface NormalizedInvoice {
  zuperInvoiceId: string;
  status: string;
  amount: number;
  amountPaid: number;
  issuedAt: Date;
  dueAt: Date | null;
  paidAt: Date | null;
}

export interface NormalizedTechnician {
  zuperUserId: string;
  name: string;
  jobsCompleted: number;
  revenue: number;
  completionRate: number;
  avgJobValue: number;
  rating: number | null;
}

export interface NormalizedPayment {
  zuperPaymentId: string;
  amount: number;
  method: string | null;
  zuperPayUsed: boolean;
  paidAt: Date;
}

// ---- Module adapters ----
// Each adapter fetches raw pages from Zuper and normalizes them.
// TODO: confirm exact paths/field names against your Zuper API reference.

export const jobsModule = {
  key: "jobs" as const,
  async *fetch(client: ZuperClient, range: DateRange) {
    for await (const page of client.paginate<Record<string, any>>("/api/jobs", "jobs", {
      start_date: range.start.toISOString(),
      end_date: range.end.toISOString(),
    })) {
      yield page.map(normalizeJob);
    }
  },
};

function normalizeJob(raw: Record<string, any>): NormalizedJob {
  return {
    zuperJobId: String(raw.job_uid ?? raw.id),
    status: String(raw.job_status ?? raw.status ?? "unknown").toLowerCase(),
    serviceType: raw.job_category ?? raw.service_type ?? null,
    location: raw.job_address?.city ?? raw.location ?? null,
    technicianId: raw.assigned_to?.user_uid ?? raw.technician_id ?? null,
    jobValue: raw.job_value != null ? Number(raw.job_value) : null,
    createdAt: new Date(raw.created_at),
    completedAt: raw.completed_at ? new Date(raw.completed_at) : null,
    scheduledAt: raw.scheduled_at ? new Date(raw.scheduled_at) : null,
  };
}

export const invoicesModule = {
  key: "invoices" as const,
  async *fetch(client: ZuperClient, range: DateRange) {
    for await (const page of client.paginate<Record<string, any>>("/api/invoices", "invoices", {
      start_date: range.start.toISOString(),
      end_date: range.end.toISOString(),
    })) {
      yield page.map(normalizeInvoice);
    }
  },
};

function normalizeInvoice(raw: Record<string, any>): NormalizedInvoice {
  return {
    zuperInvoiceId: String(raw.invoice_uid ?? raw.id),
    status: String(raw.invoice_status ?? raw.status ?? "unknown").toLowerCase(),
    amount: Number(raw.total_amount ?? raw.amount ?? 0),
    amountPaid: Number(raw.paid_amount ?? 0),
    issuedAt: new Date(raw.issued_date ?? raw.created_at),
    dueAt: raw.due_date ? new Date(raw.due_date) : null,
    paidAt: raw.paid_date ? new Date(raw.paid_date) : null,
  };
}

export const techniciansModule = {
  key: "technicians" as const,
  async *fetch(client: ZuperClient, range: DateRange) {
    for await (const page of client.paginate<Record<string, any>>("/api/users", "users", {
      role: "technician",
    })) {
      yield page.map((raw) => normalizeTechnician(raw, range));
    }
  },
};

function normalizeTechnician(raw: Record<string, any>, _range: DateRange): NormalizedTechnician {
  // NOTE: Zuper's /users endpoint likely doesn't return job/revenue rollups
  // directly — those are computed from the Job table after jobs sync (see
  // lib/analytics.ts::computeTechnicianRollups). This adapter just captures
  // identity fields; rollups overwrite jobsCompleted/revenue/etc.
  return {
    zuperUserId: String(raw.user_uid ?? raw.id),
    name: `${raw.first_name ?? ""} ${raw.last_name ?? ""}`.trim() || raw.email || "Unknown",
    jobsCompleted: 0,
    revenue: 0,
    completionRate: 0,
    avgJobValue: 0,
    rating: raw.rating != null ? Number(raw.rating) : null,
  };
}

export const paymentsModule = {
  key: "payments" as const,
  async *fetch(client: ZuperClient, range: DateRange) {
    for await (const page of client.paginate<Record<string, any>>("/api/payments", "payments", {
      start_date: range.start.toISOString(),
      end_date: range.end.toISOString(),
    })) {
      yield page.map(normalizePayment);
    }
  },
};

function normalizePayment(raw: Record<string, any>): NormalizedPayment {
  return {
    zuperPaymentId: String(raw.payment_uid ?? raw.id),
    amount: Number(raw.amount ?? 0),
    method: raw.payment_method ?? null,
    zuperPayUsed: Boolean(raw.gateway === "zuper_pay" || raw.zuper_pay === true),
    paidAt: new Date(raw.paid_at ?? raw.created_at),
  };
}

export const MODULE_REGISTRY = [jobsModule, invoicesModule, techniciansModule, paymentsModule];
export type ModuleKey = (typeof MODULE_REGISTRY)[number]["key"];
