import Link from "next/link";
import { prisma } from "@/lib/db";
import { Nav } from "@/components/Nav";
import { DatabaseUnavailable } from "@/components/DatabaseUnavailable";
import { StorageMeter } from "@/components/StorageMeter";
import { isDatabaseUnavailable } from "@/lib/dbStatus";

export const dynamic = "force-dynamic";

function loadCustomers() {
  return prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      credential: { select: { lastVerifiedAt: true } },
      syncRuns: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
    },
  });
}

/** Stored rows per customer across the tables that hold most of the data — which accounts use the space. */
async function loadRecordCounts(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ customerId: string; n: bigint }[]>`
    SELECT "customerId", COUNT(*) AS n FROM (
      SELECT "customerId" FROM "Job" UNION ALL
      SELECT "customerId" FROM "JobLineItem" UNION ALL
      SELECT "customerId" FROM "ZuperRecord" UNION ALL
      SELECT "customerId" FROM "Invoice" UNION ALL
      SELECT "customerId" FROM "Quote" UNION ALL
      SELECT "customerId" FROM "Payment" UNION ALL
      SELECT "customerId" FROM "TimesheetEvent" UNION ALL
      SELECT "customerId" FROM "EndCustomerLedger" UNION ALL
      SELECT "customerId" FROM "Property"
    ) t GROUP BY "customerId"`;
  return new Map(rows.map((r) => [r.customerId, Number(r.n)]));
}

export default async function DashboardPage() {
  let customers: Awaited<ReturnType<typeof loadCustomers>> | null = null;
  let records = new Map<string, number>();
  try {
    [customers, records] = await Promise.all([loadCustomers(), loadRecordCounts().catch(() => new Map<string, number>())]);
  } catch (err) {
    // A down database gets a plain explanation; any other error still goes to error.tsx.
    if (!isDatabaseUnavailable(err)) throw err;
    console.error("Dashboard: database unavailable", err);
  }

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="mb-6 text-lg font-semibold">Customers</h1>

        {customers !== null && <StorageMeter />}

        {customers === null ? (
          <DatabaseUnavailable />
        ) : customers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-neutral-500 dark:border-neutral-700">
            No customers yet.{" "}
            <Link href="/customers/new" className="underline">
              Add your first customer
            </Link>{" "}
            to connect their Zuper account and generate a report.
          </div>
        ) : (
          <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {customers.map((c) => {
              const lastSync = c.syncRuns[0];
              return (
                <Link
                  key={c.id}
                  href={`/customers/${c.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-sm text-neutral-500">Zuper account: {c.zuperAccountId}</div>
                  </div>
                  <div className="text-right text-sm text-neutral-500">
                    <div>{c.credential?.lastVerifiedAt ? "Connection verified" : "Not connected yet"}</div>
                    <div>{lastSync ? `Last sync: ${lastSync.status}` : "Never synced"}</div>
                    <div>{(records.get(c.id) ?? 0).toLocaleString("en-US")} records stored</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
