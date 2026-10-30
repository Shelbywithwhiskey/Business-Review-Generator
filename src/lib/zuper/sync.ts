import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ZuperClient, ZuperApiError, discoverZuperConfig } from "./client";
import {
  organizationsModule,
  propertiesModule,
  projectsModule,
  fetchExecutionSnapshot,
  jobsModule,
  invoicesModule,
  quotesModule,
  teamsModule,
  paymentsModule,
  productsModule,
  expensesModule,
  timesheetsModule,
  endCustomersModule,
  workflowsModule,
  type ModuleKey,
  type DateRange,
} from "./modules";
import { computeTechnicianRollups, computeTimesheetHours } from "@/lib/analytics";
import { CATALOG, runCatalogSync, upsertCoverage } from "./catalog";
import { ExclusionLog, storedExcludedUids } from "./testRecords";

// ---------------------------------------------------------------------------
// Step-based sync. A full pull of a large account takes longer than one
// serverless request may run (5 min on Vercel), so the customer page drives the
// sync as a loop of short requests: each runs steps until its time budget is
// spent, then returns a cursor (step + page) to resume from. Every step is
// idempotent — pages are written as "replace these records" — so a request that
// fails or times out is simply retried from the same cursor.
// ---------------------------------------------------------------------------

/** Steps in order: the core modules, workflow executions, every other Zuper module (catalog), then the roll-ups. */
export const SYNC_STEPS = [
  { key: "jobs", label: "Jobs" },
  { key: "invoices", label: "Invoices" },
  { key: "quotes", label: "Quotes" },
  { key: "teams", label: "Team" },
  { key: "payments", label: "Payments" },
  { key: "products", label: "Products & parts" },
  { key: "expenses", label: "Expenses" },
  { key: "timesheets", label: "Timesheets" },
  { key: "endCustomers", label: "Customers" },
  { key: "organizations", label: "Organizations" },
  { key: "properties", label: "Properties" },
  { key: "projects", label: "Projects" },
  { key: "workflows", label: "Workflows" },
  { key: "executions", label: "Workflow runs" },
  { key: "catalog", label: "Other Zuper modules" },
  { key: "finish", label: "Calculating" },
] as const;

type StepKey = (typeof SYNC_STEPS)[number]["key"];

/** Modules an account may simply not have (feature off / endpoint absent): a failure is noted, not fatal. */
const OPTIONAL_STEPS = new Set<StepKey>(["organizations", "properties", "projects", "executions", "timesheets", "expenses", "workflows", "products", "catalog"]);

/** Where to resume: the step, and the page within it (catalog: the catalog module index). */
export interface SyncCursor {
  step: number;
  page: number;
}

export interface StepResult {
  syncRunId: string;
  /** Null when the sync is complete. */
  cursor: SyncCursor | null;
  /** Steps finished so far, out of SYNC_STEPS.length — for the progress bar. */
  done: number;
  total: number;
  /** What's running now, e.g. "Jobs (page 12)". */
  label: string;
}

/** A sync that can't continue (bad API key): the run is marked FAILED and the page shows the message. */
export class SyncFatalError extends Error {}

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Discovered data-center config for a customer, resolving and saving it on first use. Holds no secrets. */
export async function getOrDiscoverConnection(customerId: string) {
  const existing = await prisma.apiCredential.findUnique({ where: { customerId } });
  if (existing) return existing;
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new Error("Customer not found");
  const config = await discoverZuperConfig(customer.zuperAccountId);
  return prisma.apiCredential.create({
    data: { customerId, baseUrl: config.apiBaseUrl, workflowBaseUrl: config.workflowBaseUrl },
  });
}

/** Starts a sync run. Any run still marked RUNNING for this customer was abandoned (tab closed) — it is closed as FAILED. */
export async function startSync(customerId: string, range: DateRange): Promise<StepResult> {
  await getOrDiscoverConnection(customerId);
  await prisma.syncRun.updateMany({
    where: { customerId, status: "RUNNING" },
    data: { status: "FAILED", completedAt: new Date(), errorMessage: "Interrupted — a new sync was started" },
  });
  const run = await prisma.syncRun.create({
    data: {
      customerId,
      periodStart: range.start,
      periodEnd: range.end,
      modules: SYNC_STEPS.map((s) => s.key),
      status: "RUNNING",
      startedAt: new Date(),
    },
    select: { id: true },
  });
  return { syncRunId: run.id, cursor: { step: 0, page: 1 }, done: 0, total: SYNC_STEPS.length, label: SYNC_STEPS[0].label };
}

/** Marks a run FAILED (the page gave up after retries, or a fatal error). */
export async function failSync(syncRunId: string, reason: string) {
  await prisma.syncRun.updateMany({
    where: { id: syncRunId, status: "RUNNING" },
    data: { status: "FAILED", completedAt: new Date(), errorMessage: reason.slice(0, 500) },
  });
}

/**
 * Runs steps from `cursor` until done or `budgetMs` is spent. apiKey is supplied by the user for
 * this sync only — it is never persisted or logged.
 */
export async function runSyncSteps(customerId: string, apiKey: string, syncRunId: string, cursor: SyncCursor, budgetMs = 240_000): Promise<StepResult> {
  const run = await prisma.syncRun.findFirst({ where: { id: syncRunId, customerId } });
  if (!run) throw new SyncFatalError("Sync run not found — start the sync again.");
  if (run.status !== "RUNNING") throw new SyncFatalError("This sync is no longer running — start the sync again.");

  const credential = await getOrDiscoverConnection(customerId);
  const range: DateRange = { start: run.periodStart, end: run.periodEnd };
  const deadline = Date.now() + budgetMs;
  const ctx: StepContext = { customerId, syncRunId, range, apiKey, credential, deadline, notes: [] };

  let { step, page } = cursor;
  while (step < SYNC_STEPS.length) {
    const def = SYNC_STEPS[step];
    if (Date.now() > deadline - 15_000) break;
    let next: number | null;
    try {
      next = await runStep(def.key, ctx, page);
    } catch (err) {
      if (err instanceof ZuperApiError && err.status === 401) {
        throw new SyncFatalError("Zuper rejected the API key (401). Check the key and sync again.");
      }
      if (!OPTIONAL_STEPS.has(def.key)) throw err; // retried by the page from this same cursor
      const reason = err instanceof ZuperApiError ? `HTTP ${err.status}` : err instanceof Error ? err.message : String(err);
      ctx.notes.push(`${def.key} skipped (${reason.slice(0, 120)})`);
      next = null;
    }
    if (next != null) {
      page = next; // same step, resume from this page in the next request
      break;
    }
    step += 1;
    page = step < SYNC_STEPS.length && SYNC_STEPS[step].key === "catalog" ? 0 : 1;
  }

  if (ctx.notes.length) {
    // Skipped optional modules accumulate on the run and show as "Last sync: SUCCESS — …".
    const previous = run.errorMessage ? `${run.errorMessage}; ` : "";
    await prisma.syncRun.update({ where: { id: syncRunId }, data: { errorMessage: `${previous}${ctx.notes.join("; ")}` }, select: { id: true } });
  }

  if (step >= SYNC_STEPS.length) {
    await prisma.syncRun.update({ where: { id: syncRunId }, data: { status: "SUCCESS", completedAt: new Date() }, select: { id: true } });
    return { syncRunId, cursor: null, done: SYNC_STEPS.length, total: SYNC_STEPS.length, label: "Done" };
  }
  const def = SYNC_STEPS[step];
  const where = def.key === "catalog" ? ` (${page} of ${CATALOG.length})` : page > 1 ? ` (page ${page})` : "";
  return { syncRunId, cursor: { step, page }, done: step, total: SYNC_STEPS.length, label: `${def.label}${where}` };
}

// ---- Steps ------------------------------------------------------------------------------------

interface StepContext {
  customerId: string;
  syncRunId: string;
  range: DateRange;
  apiKey: string;
  credential: { baseUrl: string; workflowBaseUrl: string | null };
  deadline: number;
  notes: string[];
}

/** Runs one step from `page`. Returns the page to resume from when time ran out, or null when the step finished. */
async function runStep(key: StepKey, ctx: StepContext, page: number): Promise<number | null> {
  switch (key) {
    case "catalog":
      return runCatalogStep(ctx, page);
    case "executions":
      await syncExecutions(ctx);
      return null;
    case "workflows":
      await syncWorkflows(ctx);
      return null;
    case "finish":
      await finish(ctx);
      return null;
    default:
      return syncPagedModule(key, ctx, page);
  }
}

/** A paged core module from `startPage`: writes each page, stops when time is short. */
async function syncPagedModule(key: Exclude<StepKey, "catalog" | "executions" | "workflows" | "finish">, ctx: StepContext, startPage: number): Promise<number | null> {
  const { customerId, syncRunId, range } = ctx;
  const client = new ZuperClient(ctx.apiKey, ctx.credential.baseUrl);
  client.pageWindow = { startPage, stopAfter: ctx.deadline - 30_000 };
  const log = new ExclusionLog();
  const tag = { customerId, syncRunId };

  switch (key) {
    case "jobs":
      for await (const page of jobsModule.fetch(client, log)) {
        const uids = page.map(({ job }) => job.zuperJobId);
        // Line items have no stable uid in the list payload, so each job's set is replaced with the job.
        await prisma.$transaction([
          prisma.jobLineItem.deleteMany({ where: { customerId, zuperJobId: { in: uids } } }),
          prisma.job.deleteMany({ where: { customerId, zuperJobId: { in: uids } } }),
          prisma.job.createMany({ data: page.map(({ job }) => ({ ...job, ...tag, statusHistory: json(job.statusHistory), extra: json(job.extra) })) }),
          prisma.jobLineItem.createMany({
            data: page.flatMap(({ job, lineItems }) => lineItems.map((item) => ({ ...item, ...tag, zuperJobId: job.zuperJobId, jobCreatedAt: job.createdAt }))),
          }),
        ]);
      }
      break;
    case "invoices":
      for await (const page of invoicesModule.fetch(client, log)) {
        await prisma.$transaction([
          prisma.invoice.deleteMany({ where: { customerId, zuperInvoiceId: { in: page.map((r) => r.zuperInvoiceId) } } }),
          prisma.invoice.createMany({ data: page.map((r) => ({ ...r, ...tag })) }),
        ]);
      }
      break;
    case "quotes":
      for await (const page of quotesModule.fetch(client, log)) {
        await prisma.$transaction([
          prisma.quote.deleteMany({ where: { customerId, zuperQuoteId: { in: page.map((r) => r.zuperQuoteId) } } }),
          prisma.quote.createMany({ data: page.map((r) => ({ ...r, ...tag })) }),
        ]);
      }
      break;
    case "teams":
      for await (const page of teamsModule.fetch(client, log)) {
        // Per-period rows; the job/hour roll-ups on them are recomputed in the finish step.
        const period = { periodStart: range.start, periodEnd: range.end };
        await prisma.$transaction([
          prisma.technician.deleteMany({ where: { customerId, ...period, zuperUserId: { in: page.map((r) => r.zuperUserId) } } }),
          prisma.technician.createMany({ data: page.map((r) => ({ ...r, ...tag, ...period })) }),
        ]);
      }
      break;
    case "payments": {
      // Payments against a test invoice are test money too (the invoices step stored their uids).
      const stored = await prisma.customer.findUnique({ where: { id: customerId }, select: { testExclusions: true } });
      const testInvoices = new Set(storedExcludedUids(stored?.testExclusions, "invoices"));
      for await (const page of paymentsModule.fetch(client, log)) {
        const real = page.filter((p) => {
          if (!p.zuperInvoiceId || !testInvoices.has(p.zuperInvoiceId)) return true;
          log.add("payments", "payment on a test invoice", p.zuperPaymentId);
          return false;
        });
        await prisma.$transaction([
          prisma.payment.deleteMany({ where: { customerId, zuperPaymentId: { in: page.map((r) => r.zuperPaymentId) } } }),
          prisma.payment.createMany({ data: real.map((r) => ({ ...r, ...tag })) }),
        ]);
      }
      break;
    }
    case "products":
      for await (const page of productsModule.fetch(client, log)) {
        await prisma.$transaction([
          prisma.product.deleteMany({ where: { customerId, zuperProductId: { in: page.map((r) => r.zuperProductId) } } }),
          prisma.product.createMany({ data: page.map((r) => ({ ...r, ...tag })) }),
        ]);
      }
      break;
    case "expenses":
      for await (const page of expensesModule.fetch(client, log)) {
        await prisma.$transaction([
          prisma.expense.deleteMany({ where: { customerId, zuperExpenseId: { in: page.map((r) => r.zuperExpenseId) } } }),
          prisma.expense.createMany({ data: page.map((r) => ({ ...r, ...tag })) }),
        ]);
      }
      break;
    case "timesheets":
      for await (const page of timesheetsModule.fetch(client, range)) {
        await prisma.$transaction([
          prisma.timesheetEvent.deleteMany({ where: { customerId, zuperTimesheetId: { in: page.map((r) => r.zuperTimesheetId) } } }),
          prisma.timesheetEvent.createMany({ data: page.map((r) => ({ ...r, ...tag })), skipDuplicates: true }),
        ]);
      }
      break;
    case "endCustomers":
      for await (const page of endCustomersModule.fetch(client, log)) {
        await prisma.$transaction([
          prisma.endCustomerLedger.deleteMany({ where: { customerId, zuperCustomerId: { in: page.map((r) => r.zuperCustomerId) } } }),
          prisma.endCustomerLedger.createMany({ data: page.map((r) => ({ ...r, ...tag })) }),
        ]);
      }
      break;
    case "organizations":
      for await (const page of organizationsModule.fetch(client, log)) {
        await prisma.$transaction([
          prisma.organization.deleteMany({ where: { customerId, zuperOrganizationId: { in: page.map((r) => r.zuperOrganizationId) } } }),
          prisma.organization.createMany({ data: page.map((r) => ({ ...r, ...tag })) }),
        ]);
      }
      break;
    case "properties":
      for await (const page of propertiesModule.fetch(client, log)) {
        await prisma.$transaction([
          prisma.property.deleteMany({ where: { customerId, zuperPropertyId: { in: page.map((r) => r.zuperPropertyId) } } }),
          prisma.property.createMany({ data: page.map((r) => ({ ...r, ...tag })) }),
        ]);
      }
      break;
    case "projects":
      for await (const page of projectsModule.fetch(client, log)) {
        await prisma.$transaction([
          prisma.project.deleteMany({ where: { customerId, zuperProjectId: { in: page.map((r) => r.zuperProjectId) } } }),
          prisma.project.createMany({ data: page.map((r) => ({ ...r, ...tag })) }),
        ]);
      }
      break;
  }

  await purgeExcluded(customerId, log);
  await saveExclusions(customerId, log, startPage > 1 ? new Set([key]) : new Set());
  return client.stoppedAtPage;
}

/** Deletes stored rows whose Zuper uid was excluded as test data (stored before the rule existed, or renamed since). */
async function purgeExcluded(customerId: string, log: ExclusionLog) {
  const ids = (module: string) => log.excludedUids(module);
  const jobs = ids("jobs");
  await Promise.all([
    jobs.length && prisma.jobLineItem.deleteMany({ where: { customerId, zuperJobId: { in: jobs } } }),
    jobs.length && prisma.job.deleteMany({ where: { customerId, zuperJobId: { in: jobs } } }),
    ids("invoices").length && prisma.invoice.deleteMany({ where: { customerId, zuperInvoiceId: { in: ids("invoices") } } }),
    ids("quotes").length && prisma.quote.deleteMany({ where: { customerId, zuperQuoteId: { in: ids("quotes") } } }),
    ids("teams").length && prisma.technician.deleteMany({ where: { customerId, zuperUserId: { in: ids("teams") } } }),
    ids("payments").length && prisma.payment.deleteMany({ where: { customerId, zuperPaymentId: { in: ids("payments") } } }),
    ids("products").length && prisma.product.deleteMany({ where: { customerId, zuperProductId: { in: ids("products") } } }),
    ids("expenses").length && prisma.expense.deleteMany({ where: { customerId, zuperExpenseId: { in: ids("expenses") } } }),
    ids("endCustomers").length && prisma.endCustomerLedger.deleteMany({ where: { customerId, zuperCustomerId: { in: ids("endCustomers") } } }),
    ids("organizations").length && prisma.organization.deleteMany({ where: { customerId, zuperOrganizationId: { in: ids("organizations") } } }),
    ids("properties").length && prisma.property.deleteMany({ where: { customerId, zuperPropertyId: { in: ids("properties") } } }),
    ids("projects").length && prisma.project.deleteMany({ where: { customerId, zuperProjectId: { in: ids("projects") } } }),
  ]);
}

/** Records this request's exclusions on the Customer; `continuing` modules add to the stored counts. */
async function saveExclusions(customerId: string, log: ExclusionLog, continuing: ReadonlySet<string>) {
  if (!Object.keys(log.modules).length) return;
  const previous = await prisma.customer.findUnique({ where: { id: customerId }, select: { testExclusions: true } });
  await prisma.customer.update({
    where: { id: customerId },
    data: { testExclusions: json(log.mergeInto(previous?.testExclusions, continuing)) },
    select: { id: true },
  });
}

/** Workflow Builder lives on a separate host — skipped quietly if it was never discovered. Tens of workflows, so one go. */
async function syncWorkflows({ customerId, syncRunId, apiKey, credential }: StepContext) {
  if (!credential.workflowBaseUrl) return;
  const client = new ZuperClient(apiKey, credential.workflowBaseUrl);
  for await (const page of workflowsModule.fetch(client)) {
    await prisma.$transaction([
      prisma.workflow.deleteMany({ where: { customerId, zuperWorkflowId: { in: page.map((r) => r.zuperWorkflowId) } } }),
      prisma.workflow.createMany({ data: page.map((r) => ({ ...r, customerId, syncRunId })) }),
    ]);
  }
  // The list is the full current set, so anything not re-seen was deleted in Zuper.
  await prisma.workflow.deleteMany({ where: { customerId, syncRunId: { not: syncRunId } } });
}

async function syncExecutions({ customerId, syncRunId, apiKey, credential, range }: StepContext) {
  if (!credential.workflowBaseUrl) return;
  const client = new ZuperClient(apiKey, credential.workflowBaseUrl);
  const workflows = await prisma.workflow.findMany({ where: { customerId }, select: { zuperWorkflowId: true, name: true } });
  const snap = await fetchExecutionSnapshot(client, workflows.map((w) => ({ workflowUid: w.zuperWorkflowId, name: w.name })), range);
  const data = { ...snap, perWorkflow: json(snap.perWorkflow), weekly: json(snap.weekly), topErrors: json(snap.topErrors), syncRunId };
  await prisma.workflowExecutionSnapshot.upsert({
    where: { customerId_periodStart_periodEnd: { customerId, periodStart: range.start, periodEnd: range.end } },
    create: { ...data, customerId, periodStart: range.start, periodEnd: range.end },
    update: data,
    select: { id: true },
  });
}

/** Every other Zuper module, from catalog index `startIndex`; returns the index to resume from, or null. */
async function runCatalogStep(ctx: StepContext, startIndex: number): Promise<number | null> {
  const { nextIndex } = await runCatalogSync(ctx.customerId, ctx.apiKey, ctx.credential.baseUrl, ctx.range, ctx.syncRunId, { startIndex, deadline: ctx.deadline - 10_000 });
  return nextIndex;
}

/** Roll-ups derived from the stored rows, and the coverage rows for the core modules. */
async function finish({ customerId, syncRunId, range }: StepContext) {
  await computeTechnicianRollups(customerId, range);
  await computeTimesheetHours(customerId, range);

  const run = await prisma.syncRun.findUnique({ where: { id: syncRunId }, select: { errorMessage: true } });
  const skipped = (key: string) => run?.errorMessage?.split("; ").find((n) => n.startsWith(`${key} skipped`)) ?? null;
  const typedCounts: [ModuleKey, string, string, () => Promise<number>][] = [
    ["jobs", "Jobs", "GET /jobs", () => prisma.job.count({ where: { customerId } })],
    ["invoices", "Invoices", "GET /invoice", () => prisma.invoice.count({ where: { customerId } })],
    ["quotes", "Quotes (estimates)", "GET /estimate", () => prisma.quote.count({ where: { customerId } })],
    ["teams", "Team members", "GET /team", () => prisma.technician.count({ where: { customerId, periodStart: range.start, periodEnd: range.end } })],
    ["payments", "Payments", "GET /payments/transactions", () => prisma.payment.count({ where: { customerId } })],
    ["products", "Products & parts catalog", "GET /product", () => prisma.product.count({ where: { customerId } })],
    ["expenses", "Expenses", "GET /expenses", () => prisma.expense.count({ where: { customerId } })],
    ["timesheets", "Timesheets (clock in/out)", "GET /timesheets", () => prisma.timesheetEvent.count({ where: { customerId } })],
    ["endCustomers", "Customers", "GET /customers", () => prisma.endCustomerLedger.count({ where: { customerId } })],
    ["organizations", "Organizations", "GET /organization", () => prisma.organization.count({ where: { customerId } })],
    ["properties", "Properties", "GET /property", () => prisma.property.count({ where: { customerId } })],
    ["projects", "Projects", "GET /projects", () => prisma.project.count({ where: { customerId } })],
    ["workflows", "Workflows", "GET workflow:/workflows", () => prisma.workflow.count({ where: { customerId } })],
    ["executions", "Workflow executions", "GET workflow:/workflows/execution_history", () => prisma.workflowExecutionSnapshot.count({ where: { customerId } })],
  ];
  for (const [key, label, endpoint, count] of typedCounts) {
    const note = skipped(key);
    const n = note ? 0 : await count();
    await upsertCoverage(customerId, syncRunId, { module: key, label, endpoint, status: note ? "error" : n > 0 ? "ok" : "empty", recordCount: n, message: note });
  }

  await prisma.apiCredential.update({ where: { customerId }, data: { lastVerifiedAt: new Date() }, select: { id: true } });
}

// ---- "Is there a finished sync?" — gates metrics, reports and deck exports ----------------------

export type SyncReadiness = { ready: true } | { ready: false; reason: string };

/** Reports and exports need a completed sync, and none running (a half-written sync would mix old and new data). */
export async function syncReadiness(customerId: string): Promise<SyncReadiness> {
  const latest = await prisma.syncRun.findFirst({ where: { customerId }, orderBy: { createdAt: "desc" }, select: { status: true } });
  if (!latest) return { ready: false, reason: "Sync this customer from Zuper first." };
  if (latest.status === "RUNNING" || latest.status === "PENDING") return { ready: false, reason: "A sync is still running — wait for it to finish." };
  if (latest.status === "FAILED") return { ready: false, reason: "The last sync didn't finish — run the sync again." };
  return { ready: true };
}
