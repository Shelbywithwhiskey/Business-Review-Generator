"use client";

import { useEffect, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";

interface Customer {
  id: string;
  name: string;
  zuperAccountId: string;
  credential: { baseUrl: string; lastVerifiedAt: string | null } | null;
  syncRuns: { id: string; status: string; periodStart: string; periodEnd: string; errorMessage: string | null; createdAt: string }[];
}

function defaultPeriod() {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 3);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [period, setPeriod] = useState(defaultPeriod());
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);

  async function loadCustomer() {
    const res = await fetch(`/api/customers/${id}`);
    if (res.ok) setCustomer((await res.json()).customer);
  }

  useEffect(() => {
    loadCustomer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveApiKey(e: React.FormEvent) {
    e.preventDefault();
    setSavingKey(true);
    setCredentialError(null);
    const res = await fetch(`/api/customers/${id}/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    setSavingKey(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCredentialError(data.error ?? "Failed to save API key");
      return;
    }
    setApiKey("");
    await loadCustomer();
  }

  async function verifyConnection() {
    setVerifyResult("Checking…");
    const res = await fetch(`/api/customers/${id}/credentials`, { method: "PATCH" });
    const data = await res.json();
    setVerifyResult(data.ok ? "Connection verified" : "Could not connect — check the API key");
    await loadCustomer();
  }

  async function runSync() {
    setSyncing(true);
    setSyncError(null);
    const res = await fetch(`/api/customers/${id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodStart: period.start, periodEnd: period.end }),
    });
    setSyncing(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSyncError(data.error ?? "Sync failed");
      await loadCustomer();
      return;
    }
    await loadCustomer();
    await loadMetrics();
  }

  async function loadMetrics() {
    setLoadingMetrics(true);
    const res = await fetch(
      `/api/customers/${id}/metrics?periodStart=${period.start}&periodEnd=${period.end}`
    );
    setLoadingMetrics(false);
    if (res.ok) setMetrics(await res.json());
  }

  async function generateReport() {
    setGeneratingReport(true);
    const res = await fetch(`/api/customers/${id}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodStart: period.start, periodEnd: period.end }),
    });
    setGeneratingReport(false);
    if (res.ok) {
      const { reportId } = await res.json();
      router.push(`/reports/${reportId}`);
    }
  }

  if (!customer) {
    return (
      <div>
        <Nav />
        <main className="mx-auto max-w-4xl px-6 py-8 text-neutral-500">Loading…</main>
      </div>
    );
  }

  const latestSync = customer.syncRuns[0];

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-4xl space-y-8 px-6 py-8">
        <div>
          <h1 className="text-lg font-semibold">{customer.name}</h1>
          <p className="text-sm text-neutral-500">Zuper account: {customer.zuperAccountId}</p>
        </div>

        <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">Zuper API connection</h2>
          {customer.credential ? (
            <p className="mb-3 text-sm text-neutral-500">
              Key saved · {customer.credential.lastVerifiedAt ? `verified ${new Date(customer.credential.lastVerifiedAt).toLocaleString()}` : "not yet verified"}
            </p>
          ) : (
            <p className="mb-3 text-sm text-neutral-500">No API key saved yet.</p>
          )}
          <form onSubmit={saveApiKey} className="mb-3 flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Zuper API key"
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="submit"
              disabled={savingKey || !apiKey}
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {savingKey ? "Saving…" : "Save key"}
            </button>
          </form>
          <p className="mb-3 text-xs text-neutral-400">
            The correct Zuper data center is auto-discovered from the Zuper account ID above.
          </p>
          {credentialError && <p className="mb-2 text-sm text-red-500">{credentialError}</p>}
          {customer.credential && (
            <button onClick={verifyConnection} className="text-sm underline">
              Test connection
            </button>
          )}
          {verifyResult && <p className="mt-2 text-sm text-neutral-500">{verifyResult}</p>}
        </section>

        <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">Analyze account</h2>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">From</label>
              <input
                type="date"
                value={period.start}
                onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))}
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">To</label>
              <input
                type="date"
                value={period.end}
                onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
            </div>
            <button
              onClick={runSync}
              disabled={syncing || !customer.credential}
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {syncing ? "Syncing… (this can take a bit)" : "Sync from Zuper"}
            </button>
            <button
              onClick={loadMetrics}
              disabled={loadingMetrics}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
            >
              {loadingMetrics ? "Loading…" : "Load metrics"}
            </button>
          </div>
          {!customer.credential && (
            <p className="text-sm text-amber-600">Save a Zuper API key above before syncing.</p>
          )}
          {syncError && <p className="text-sm text-red-500">{syncError}</p>}
          {latestSync && (
            <p className="text-sm text-neutral-500">
              Last sync: {latestSync.status}
              {latestSync.errorMessage ? ` — ${latestSync.errorMessage}` : ""}
            </p>
          )}
        </section>

        {metrics && (
          <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
            <h2 className="mb-4 font-medium">Metrics for period</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Kpi label="Jobs" value={metrics.current.jobs.total} />
              <Kpi label="Completed" value={metrics.current.jobs.completed} />
              <Kpi label="Invoices" value={metrics.current.invoices.total} />
              <Kpi label="Revenue" value={`$${metrics.current.invoices.totalPaid.toFixed(0)}`} />
              <Kpi label="Outstanding" value={`$${metrics.current.invoices.outstanding.toFixed(0)}`} />
              <Kpi label="90+ days past due" value={`$${metrics.current.invoices.aging.d90plus.toFixed(0)}`} />
              <Kpi label="Quotes sent" value={`${metrics.current.quotes.total} ($${metrics.current.quotes.totalValue.toFixed(0)})`} />
              <Kpi label="Quote conversion" value={`${(metrics.current.quotes.conversionRate * 100).toFixed(0)}%`} />
              <Kpi label="Collected digitally" value={`${(metrics.current.payments.onlineShare * 100).toFixed(0)}%`} />
              <Kpi label="Inventory value" value={`$${metrics.current.inventory.totalValue.toFixed(0)}`} />
              <Kpi label="Low stock items" value={metrics.current.inventory.lowStockCount} />
              <Kpi label="Account LTV (Zuper)" value={`$${metrics.current.ledger.totalLtv.toFixed(0)}`} />
              <Kpi label="Receivables (Zuper)" value={`$${metrics.current.ledger.totalReceivables.toFixed(0)}`} />
              <Kpi label="Health score" value={`${metrics.health.overall}/100`} />
            </div>
            {metrics.rules.length > 0 && (
              <div className="mt-4 space-y-2">
                {metrics.rules.map((r: any) => (
                  <div key={r.key} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    {r.detail}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium">Invoices by status</h3>
                <StatusTable
                  rows={Object.entries(metrics.current.invoices.byStatusDetail as Record<string, any>).map(
                    ([status, d]: [string, any]) => ({
                      label: status,
                      count: d.count,
                      right: `$${d.amount.toFixed(0)} · $${d.amountPaid.toFixed(0)} paid`,
                    })
                  )}
                />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">Jobs by status</h3>
                <StatusTable
                  rows={Object.entries(metrics.current.jobs.byStatusDetail as Record<string, any>)
                    .sort((a: any, b: any) => b[1].count - a[1].count)
                    .map(([status, d]: [string, any]) => ({
                      label: status,
                      count: d.count,
                      right: `$${d.value.toFixed(0)}`,
                    }))}
                />
              </div>
            </div>

            <div className="mt-6 rounded-md border border-indigo-200 bg-indigo-50 p-4 text-sm dark:border-indigo-900 dark:bg-indigo-950">
              <h3 className="mb-2 font-medium text-indigo-900 dark:text-indigo-200">Key insights for this QBR</h3>
              <ul className="space-y-1 text-indigo-800 dark:text-indigo-300">
                {metrics.current.insights.powerTechnician && (
                  <li>
                    Power performer: <strong>{metrics.current.insights.powerTechnician.name}</strong> — $
                    {metrics.current.insights.powerTechnician.revenue.toFixed(0)} (
                    {(metrics.current.insights.powerTechnician.sharePctOfRevenue * 100).toFixed(0)}% of technician
                    revenue)
                  </li>
                )}
                {metrics.current.insights.topServiceTypeByRevenue && (
                  <li>
                    Top service type by revenue: <strong>{metrics.current.insights.topServiceTypeByRevenue.type}</strong> ($
                    {metrics.current.insights.topServiceTypeByRevenue.revenue.toFixed(0)})
                  </li>
                )}
                {metrics.current.insights.avgDaysToPay != null && (
                  <li>Average days to collect payment: {metrics.current.insights.avgDaysToPay.toFixed(1)} days</li>
                )}
                {metrics.current.insights.avgDaysQuoteToClose != null && (
                  <li>Average days from quote sent to accepted: {metrics.current.insights.avgDaysQuoteToClose.toFixed(1)} days</li>
                )}
                <li>
                  Repeat customer rate: {(metrics.current.insights.repeatCustomerRate * 100).toFixed(0)}% · Top 5
                  customers hold {(metrics.current.insights.revenueConcentrationTop5Pct * 100).toFixed(0)}% of account LTV
                </li>
                {metrics.current.insights.dormantSeats.length > 0 && (
                  <li>
                    Dormant licensed seats: {metrics.current.insights.dormantSeats.map((s: any) => s.name).join(", ")}
                  </li>
                )}
                {metrics.current.insights.highValueCustomersInactiveThisPeriod.length > 0 && (
                  <li>
                    High-value customers with no activity this period:{" "}
                    {metrics.current.insights.highValueCustomersInactiveThisPeriod
                      .map((c: any) => `${c.name} ($${c.ltv.toFixed(0)} LTV)`)
                      .join(", ")}
                  </li>
                )}
              </ul>
            </div>

            <button
              onClick={generateReport}
              disabled={generatingReport}
              className="mt-5 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {generatingReport ? "Generating report…" : "Generate QBR"}
            </button>
          </section>
        )}
      </main>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function StatusTable({ rows }: { rows: { label: string; count: number; right: string }[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-400">No data for this period.</p>;
  }
  return (
    <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="px-3 py-1.5">{r.label}</td>
              <td className="px-3 py-1.5 text-right text-neutral-500">{r.count}</td>
              <td className="px-3 py-1.5 text-right text-neutral-500">{r.right}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
