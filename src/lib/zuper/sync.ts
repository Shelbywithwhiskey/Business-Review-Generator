import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { ZuperClient } from "./client";
import {
  jobsModule,
  invoicesModule,
  quotesModule,
  teamsModule,
  paymentsModule,
  productsModule,
  expensesModule,
  timesheetsModule,
  endCustomersModule,
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
];

export async function runSync(
  customerId: string,
  range: DateRange,
  modules: ModuleKey[] = ALL_MODULES
): Promise<{ syncRunId: string }> {
  const credential = await prisma.apiCredential.findUnique({ where: { customerId } });
  if (!credential) throw new Error("No API credential saved for this customer");

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

  const client = new ZuperClient(decryptSecret(credential.encryptedApiKey), credential.baseUrl);

  try {
    if (modules.includes("jobs")) {
      for await (const page of jobsModule.fetch(client)) {
        await Promise.all(
          page.map((job) =>
            prisma.job.upsert({
              where: { customerId_zuperJobId: { customerId, zuperJobId: job.zuperJobId } },
              create: { ...job, customerId, syncRunId: syncRun.id },
              update: { ...job, syncRunId: syncRun.id },
            })
          )
        );
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

    if (modules.includes("expenses")) {
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
    }

    if (modules.includes("timesheets")) {
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
    }

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
      data: { status: "SUCCESS", completedAt: new Date() },
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
