import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { ZuperClient } from "./client";
import {
  jobsModule,
  invoicesModule,
  techniciansModule,
  paymentsModule,
  type ModuleKey,
  type DateRange,
} from "./modules";
import { computeTechnicianRollups } from "@/lib/analytics";

export async function runSync(
  customerId: string,
  range: DateRange,
  modules: ModuleKey[] = ["jobs", "invoices", "technicians", "payments"]
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
      for await (const page of jobsModule.fetch(client, range)) {
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
      for await (const page of invoicesModule.fetch(client, range)) {
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

    if (modules.includes("technicians")) {
      for await (const page of techniciansModule.fetch(client, range)) {
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
              update: { name: tech.name, rating: tech.rating, syncRunId: syncRun.id },
            })
          )
        );
      }
    }

    if (modules.includes("payments")) {
      for await (const page of paymentsModule.fetch(client, range)) {
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

    // Jobs must be synced before technician rollups can be computed from them.
    if (modules.includes("jobs") && modules.includes("technicians")) {
      await computeTechnicianRollups(customerId, range);
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
