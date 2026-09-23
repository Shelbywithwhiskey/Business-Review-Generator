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

export const ALL_MODULES: ModuleKey[] = [
  "jobs",
  "invoices",
  "quotes",
  "teams",
  "payments",
  "products",
  "expenses",
  "timesheets",
  "endCustomers",
  "organizations",
  "properties",
  "projects",
  "workflows",
  "executions",
];

/** Modules an account may simply not have (feature off / endpoint absent). Their failure is
 * recorded on the SyncRun as a note instead of failing the whole sync. */
const OPTIONAL_MODULES = new Set<ModuleKey>(["organizations", "properties", "projects", "executions", "timesheets", "expenses"]);

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

/** apiKey is supplied by the user for this sync only — it is never persisted or logged. */
export async function runSync(
  customerId: string,
  apiKey: string,
  range: DateRange,
  modules: ModuleKey[] = ALL_MODULES
): Promise<{ syncRunId: string }> {
  const credential = await getOrDiscoverConnection(customerId);

  const syncRun = await prisma.syncRun.create({
    data: {
      customerId,
      periodStart: range.start,
      periodEnd: range.end,
      modules,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  const client = new ZuperClient(apiKey, credential.baseUrl);
  const notes: string[] = [];

  /** Runs an optional module; on failure records "module: reason" and carries on. */
  async function optional(key: ModuleKey, fn: () => Promise<void>) {
    if (!modules.includes(key)) return;
    try {
      await fn();
    } catch (err) {
      if (!OPTIONAL_MODULES.has(key)) throw err;
      const reason = err instanceof ZuperApiError ? `HTTP ${err.status}` : err instanceof Error ? err.message : String(err);
      notes.push(`${key} skipped (${reason})`);
    }
  }

  try {
    if (modules.includes("jobs")) {
      for await (const page of jobsModule.fetch(client)) {
        await Promise.all(
          page.map(({ job }) => {
            const data = { ...job, statusHistory: json(job.statusHistory) };
            return prisma.job.upsert({
              where: { customerId_zuperJobId: { customerId, zuperJobId: job.zuperJobId } },
              create: { ...data, customerId, syncRunId: syncRun.id },
              update: { ...data, syncRunId: syncRun.id },
            });
          })
        );
        // Line items have no stable uid in the list payload, so each job's set is replaced wholesale.
        await prisma.$transaction([
          prisma.jobLineItem.deleteMany({
            where: { customerId, zuperJobId: { in: page.map(({ job }) => job.zuperJobId) } },
          }),
          prisma.jobLineItem.createMany({
            data: page.flatMap(({ job, lineItems }) =>
              lineItems.map((item) => ({
                ...item,
                customerId,
                zuperJobId: job.zuperJobId,
                jobCreatedAt: job.createdAt,
                syncRunId: syncRun.id,
              }))
            ),
          }),
        ]);
      }
    }

    if (modules.includes("invoices")) {
      for await (const page of invoicesModule.fetch(client)) {
        await Promise.all(
          page.map((invoice) =>
            prisma.invoice.upsert({
              where: { customerId_zuperInvoiceId: { customerId, zuperInvoiceId: invoice.zuperInvoiceId } },
              create: { ...invoice, customerId, syncRunId: syncRun.id },
              update: { ...invoice, syncRunId: syncRun.id },
            })
          )
        );
      }
    }

    if (modules.includes("quotes")) {
      for await (const page of quotesModule.fetch(client)) {
        await Promise.all(
          page.map((quote) =>
            prisma.quote.upsert({
              where: { customerId_zuperQuoteId: { customerId, zuperQuoteId: quote.zuperQuoteId } },
              create: { ...quote, customerId, syncRunId: syncRun.id },
              update: { ...quote, syncRunId: syncRun.id },
            })
          )
        );
      }
    }

    if (modules.includes("teams")) {
      for await (const page of teamsModule.fetch(client)) {
        await Promise.all(
          page.map((tech) =>
            prisma.technician.upsert({
              where: {
                customerId_zuperUserId_periodStart_periodEnd: {
                  customerId,
                  zuperUserId: tech.zuperUserId,
                  periodStart: range.start,
                  periodEnd: range.end,
                },
              },
              create: { ...tech, customerId, periodStart: range.start, periodEnd: range.end, syncRunId: syncRun.id },
              update: {
                name: tech.name,
                email: tech.email,
                designation: tech.designation,
                hourlyRate: tech.hourlyRate,
                isActive: tech.isActive,
                licenseType: tech.licenseType,
                lastLoginAt: tech.lastLoginAt,
                syncRunId: syncRun.id,
              },
            })
          )
        );
      }
    }

    if (modules.includes("payments")) {
      for await (const page of paymentsModule.fetch(client)) {
        await Promise.all(
          page.map((payment) =>
            prisma.payment.upsert({
              where: { customerId_zuperPaymentId: { customerId, zuperPaymentId: payment.zuperPaymentId } },
              create: { ...payment, customerId, syncRunId: syncRun.id },
              update: { ...payment, syncRunId: syncRun.id },
            })
          )
        );
      }
    }

    if (modules.includes("products")) {
      for await (const page of productsModule.fetch(client)) {
        await Promise.all(
          page.map((product) =>
            prisma.product.upsert({
              where: { customerId_zuperProductId: { customerId, zuperProductId: product.zuperProductId } },
              create: { ...product, customerId, syncRunId: syncRun.id },
              update: { ...product, syncRunId: syncRun.id },
            })
          )
        );
      }
    }

    await optional("expenses", async () => {
      for await (const page of expensesModule.fetch(client)) {
        await Promise.all(
          page.map((expense) =>
            prisma.expense.upsert({
              where: { customerId_zuperExpenseId: { customerId, zuperExpenseId: expense.zuperExpenseId } },
              create: { ...expense, customerId, syncRunId: syncRun.id },
              update: { ...expense, syncRunId: syncRun.id },
            })
          )
        );
      }
    });

    await optional("timesheets", async () => {
      for await (const page of timesheetsModule.fetch(client, range)) {
        await Promise.all(
          page.map((event) =>
            prisma.timesheetEvent.upsert({
              where: { customerId_zuperTimesheetId: { customerId, zuperTimesheetId: event.zuperTimesheetId } },
              create: { ...event, customerId, syncRunId: syncRun.id },
              update: { ...event, syncRunId: syncRun.id },
            })
          )
        );
      }
    });

    if (modules.includes("endCustomers")) {
      for await (const page of endCustomersModule.fetch(client)) {
        await Promise.all(
          page.map((endCustomer) =>
            prisma.endCustomerLedger.upsert({
              where: { customerId_zuperCustomerId: { customerId, zuperCustomerId: endCustomer.zuperCustomerId } },
              create: { ...endCustomer, customerId, syncRunId: syncRun.id },
              update: { ...endCustomer, syncRunId: syncRun.id },
            })
          )
        );
      }
    }

    await optional("organizations", async () => {
      for await (const page of organizationsModule.fetch(client)) {
        await Promise.all(
          page.map((org) =>
            prisma.organization.upsert({
              where: { customerId_zuperOrganizationId: { customerId, zuperOrganizationId: org.zuperOrganizationId } },
              create: { ...org, customerId, syncRunId: syncRun.id },
              update: { ...org, syncRunId: syncRun.id },
            })
          )
        );
      }
    });

    await optional("properties", async () => {
      for await (const page of propertiesModule.fetch(client)) {
        await Promise.all(
          page.map((property) =>
            prisma.property.upsert({
              where: { customerId_zuperPropertyId: { customerId, zuperPropertyId: property.zuperPropertyId } },
              create: { ...property, customerId, syncRunId: syncRun.id },
              update: { ...property, syncRunId: syncRun.id },
            })
          )
        );
      }
    });

    await optional("projects", async () => {
      for await (const page of projectsModule.fetch(client)) {
        await Promise.all(
          page.map((project) =>
            prisma.project.upsert({
              where: { customerId_zuperProjectId: { customerId, zuperProjectId: project.zuperProjectId } },
              create: { ...project, customerId, syncRunId: syncRun.id },
              update: { ...project, syncRunId: syncRun.id },
            })
          )
        );
      }
    });

    // Workflow Builder lives on a separate host — skip quietly if it was never
    // discovered (older credential, or the account has no Workflow Builder access).
    if (modules.includes("workflows") && credential.workflowBaseUrl) {
      const workflowClient = new ZuperClient(apiKey, credential.workflowBaseUrl);
      for await (const page of workflowsModule.fetch(workflowClient)) {
        await Promise.all(
          page.map((workflow) =>
            prisma.workflow.upsert({
              where: { customerId_zuperWorkflowId: { customerId, zuperWorkflowId: workflow.zuperWorkflowId } },
              create: { ...workflow, customerId, syncRunId: syncRun.id },
              update: { ...workflow, syncRunId: syncRun.id },
            })
          )
        );
      }
      // The list is the full current set, so anything not re-seen was deleted in Zuper.
      await prisma.workflow.deleteMany({ where: { customerId, syncRunId: { not: syncRun.id } } });
    }

    const workflowBaseUrl = credential.workflowBaseUrl;
    if (workflowBaseUrl) {
      await optional("executions", async () => {
        const workflowClient = new ZuperClient(apiKey, workflowBaseUrl);
        const workflows = await prisma.workflow.findMany({ where: { customerId }, select: { zuperWorkflowId: true, name: true } });
        const snap = await fetchExecutionSnapshot(
          workflowClient,
          workflows.map((w) => ({ workflowUid: w.zuperWorkflowId, name: w.name })),
          range
        );
        const data = {
          ...snap,
          perWorkflow: json(snap.perWorkflow),
          weekly: json(snap.weekly),
          topErrors: json(snap.topErrors),
          syncRunId: syncRun.id,
        };
        await prisma.workflowExecutionSnapshot.upsert({
          where: { customerId_periodStart_periodEnd: { customerId, periodStart: range.start, periodEnd: range.end } },
          create: { ...data, customerId, periodStart: range.start, periodEnd: range.end },
          update: data,
        });
      });
    }

    // Rollups derived from raw synced rows, not from the Zuper API directly.
    if (modules.includes("jobs") && modules.includes("teams")) {
      await computeTechnicianRollups(customerId, range);
    }
    if (modules.includes("timesheets") && modules.includes("teams")) {
      await computeTimesheetHours(customerId, range);
    }

    await prisma.apiCredential.update({
      where: { customerId },
      data: { lastVerifiedAt: new Date() },
    });

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      // Notes (skipped optional modules) surface as "Last sync: SUCCESS — …" on the customer page.
      data: { status: "SUCCESS", completedAt: new Date(), errorMessage: notes.length ? notes.join("; ") : null },
    });
  } catch (err) {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }

  return { syncRunId: syncRun.id };
}
