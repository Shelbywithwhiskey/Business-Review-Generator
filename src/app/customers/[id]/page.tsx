"use client";

import { useEffect, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { exclusionModuleLabel } from "@/lib/zuper/testRecords";
import { REPORT_TYPES, REPORT_TYPE_ORDER, defaultPeriod, type ReportTypeKey } from "@/lib/reports/reportTypes";

interface Customer {
  id: string;
  name: string;
  zuperAccountId: string;
  website: string | null;
  notes: string | null;
  testExclusions: { modules: Record<string, { count: number; examples: string[] }> } | null;
  credential: { baseUrl: string; lastVerifiedAt: string | null } | null;
  syncRuns: { id: string; status: string; periodStart: string; periodEnd: string; errorMessage: string | null; createdAt: string }[];
}

/** /api/customers/[id]/sync/step response (success fields, or error fields). */
interface StepResponse {
  syncRunId?: string;
  cursor?: { step: number; page: number } | null;
  done?: number;
  total?: number;
  label?: string;
  error?: string;
}


export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Held in component state only for the next sync/test — never saved server-side or in browser storage.
  const [apiKey, setApiKey] = useState("");
  const [testingKey, setTestingKey] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [period, setPeriod] = useState(defaultPeriod("QBR"));
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [website, setWebsite] = useState("");
  const [about, setAbout] = useState("");
  const [savingWebsite, setSavingWebsite] = useState(false);
  const [reportType, setReportType] = useState<ReportTypeKey>("QBR");

  /** The review type sets the period (last month / quarter / half-year / year); dates stay editable. */
  function chooseReportType(type: ReportTypeKey) {
    setReportType(type);
    setPeriod(defaultPeriod(type));
    setMetrics(null);
  }

  async function loadCustomer() {
    const res = await fetch(`/api/customers/${id}`);
    if (res.ok) {
      const c = (await res.json()).customer;
      setCustomer(c);
      setWebsite(c.website ?? "");
      setAbout(c.notes ?? "");
    }
  }

  async function saveWebsite(e: React.FormEvent) {
    e.preventDefault();
    setSavingWebsite(true);
    await fetch(`/api/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ website, notes: about }),
    });
    setSavingWebsite(false);
    await loadCustomer();
  }

  useEffect(() => {
    loadCustomer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function testConnection() {
    setTestingKey(true);
    setCredentialError(null);
    setVerifyResult(null);
    const res = await fetch(`/api/customers/${id}/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    setTestingKey(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCredentialError(data.error ?? "Connection test failed");
      return;
    }
    setVerifyResult(data.ok ? "Connection verified" : `Could not connect — ${data.failure ?? "check the API key"}`);
    await loadCustomer();
  }

  // Closing the tab mid-sync stops it (the page drives it), so warn first.
  useEffect(() => {
    if (!syncing) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [syncing]);

  /**
   * Drives the step-based sync: each call works for up to ~4 minutes and returns where to resume.
   * A failed call is retried from the same point (safe — every step rewrites its own records).
   */
  async function runSync() {
    setSyncing(true);
    setSyncError(null);
    setMetrics(null);
    setSyncProgress({ done: 0, total: 1, label: "Starting" });
    let syncRunId: string | undefined;
    let cursor: { step: number; page: number } | undefined;
    let label = "Starting";
    let failures = 0;
    let ok = false;
    while (true) {
      let res: Response | null = null;
      let data: StepResponse = {};
      try {
        res = await fetch(`/api/customers/${id}/sync/step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey, periodStart: period.start, periodEnd: period.end, syncRunId, cursor }),
        });
        data = await res.json().catch(() => ({}));
      } catch {
        // network drop — retried below
      }
      if (res?.ok) {
        failures = 0;
        syncRunId = data.syncRunId;
        label = data.label ?? label;
        setSyncProgress({ done: data.done ?? 0, total: data.total ?? 1, label });
        if (!data.cursor) {
          ok = true;
          break;
        }
        cursor = data.cursor;
        continue;
      }
      if (res && (res.status === 400 || res.status === 422)) {
        setSyncError(data.error ?? "Sync failed");
        break;
      }
      syncRunId ??= data.syncRunId;
      if (syncRunId && !cursor) cursor = { step: 0, page: 1 };
      failures += 1;
      if (failures > 3) {
        const reason = data.error ?? "the server didn't respond";
        if (syncRunId) {
          await fetch(`/api/customers/${id}/sync/step`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey, syncRunId, abort: `Stopped at ${label}: ${reason}` }),
          }).catch(() => {});
        }
        setSyncError(`Sync stopped at ${label} after 3 retries: ${reason}. Run the sync again.`);
        break;
      }
      setSyncProgress((p) => (p ? { ...p, label: `${label} — retrying (${failures} of 3)` } : p));
      await new Promise((r) => setTimeout(r, 3000 * failures));
    }
    setSyncing(false);
    setSyncProgress(null);
    if (ok) setApiKey("");
    await loadCustomer();
    if (ok) await loadMetrics();
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
      body: JSON.stringify({ periodStart: period.start, periodEnd: period.end, type: reportType }),
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
  // Metrics and reports only from a finished sync (the server enforces this too).
  const syncReady = !syncing && latestSync?.status === "SUCCESS";
  const excluded = Object.entries(customer.testExclusions?.modules ?? {}).filter(([, m]) => m.count > 0);

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-4xl space-y-8 px-6 py-8">
        <div>
          <h1 className="text-lg font-semibold">{customer.name}</h1>
          <p className="text-sm text-neutral-500">Zuper account: {customer.zuperAccountId}</p>
        </div>

        <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">Company context</h2>
          <p className="mb-3 text-xs text-neutral-500">
            Used by the Account Brief to understand the business. The website is scraped for framing only and is never a
            source of numbers.
          </p>
          <form onSubmit={saveWebsite} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Website</label>
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="acmefieldservices.com"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">About the company</label>
              <textarea
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                rows={5}
                placeholder="What they do and who they serve (e.g. commercial HVAC maintenance for schools and offices in Texas, ~40 technicians, 2 branches). Why they bought Zuper, what they care about, anything said in the last review."
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
            </div>
            <button
              type="submit"
              disabled={savingWebsite}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
            >
              {savingWebsite ? "Saving…" : "Save"}
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">Zuper API connection</h2>
          <p className="mb-3 text-sm text-neutral-500">
            {customer.credential?.lastVerifiedAt
              ? `Last verified ${new Date(customer.credential.lastVerifiedAt).toLocaleString()}`
              : "Not verified yet"}
          </p>
          <div className="mb-3 flex gap-2">
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Zuper API key"
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              onClick={testConnection}
              disabled={testingKey || !apiKey}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
            >
              {testingKey ? "Testing…" : "Test connection"}
            </button>
          </div>
          <p className="mb-3 text-xs text-neutral-400">
            The key is never saved — enter it each time you sync. It&apos;s cleared once a sync finishes. The Zuper data
            center is auto-discovered from the account ID above.
          </p>
          {credentialError && <p className="mb-2 text-sm text-red-500">{credentialError}</p>}
          {verifyResult && <p className="mt-2 text-sm text-neutral-500">{verifyResult}</p>}
        </section>

        <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">Analyze account</h2>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Review</label>
              <select
                value={reportType}
                onChange={(e) => chooseReportType(e.target.value as ReportTypeKey)}
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                {REPORT_TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {REPORT_TYPES[t].name}
                  </option>
                ))}
              </select>
            </div>
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
              disabled={syncing || !apiKey}
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {syncing ? "Syncing…" : "Sync from Zuper"}
            </button>
            <button
              onClick={loadMetrics}
              disabled={loadingMetrics || !syncReady}
              title={syncReady ? undefined : "Available once a sync has completed"}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
            >
              {loadingMetrics ? "Loading…" : "Load metrics"}
            </button>
          </div>
          {syncProgress && (
            <div className="mb-2" role="status">
              <div className="mb-1 flex justify-between text-sm text-neutral-600 dark:text-neutral-400">
                <span>Syncing: {syncProgress.label}</span>
                <span>{Math.round((syncProgress.done / Math.max(syncProgress.total, 1)) * 100)}%</span>
              </div>
              <div className="h-2 rounded bg-neutral-200 dark:bg-neutral-800">
                <div
                  className="h-2 rounded bg-orange-600 transition-all"
                  style={{ width: `${Math.max(3, (syncProgress.done / Math.max(syncProgress.total, 1)) * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-neutral-500">Keep this tab open until it finishes. Large accounts can take several minutes.</p>
            </div>
          )}
          {!apiKey && !syncing && <p className="text-sm text-amber-600">Enter the Zuper API key above to sync.</p>}
          {syncError && <p className="text-sm text-red-500">{syncError}</p>}
          {latestSync && !syncing && (
            <p className="text-sm text-neutral-500">
              {latestSync.status === "SUCCESS"
                ? `Synced (started ${new Date(latestSync.createdAt).toLocaleString()}) — metrics and reports are ready.`
                : latestSync.status === "RUNNING"
                  ? "A sync is in progress (or was interrupted). Run the sync again to finish it."
                  : "The last sync didn't finish — run the sync again before loading metrics or reports."}
              {latestSync.errorMessage ? ` (${latestSync.errorMessage})` : ""}
            </p>
          )}
          {!latestSync && !syncing && <p className="text-sm text-neutral-500">Not synced yet — metrics and reports unlock after the first sync.</p>}
          {excluded.length > 0 && (
            <details className="text-sm text-neutral-500">
              <summary className="cursor-pointer">
                Left out as test / Zuper setup data: {excluded.map(([m, v]) => `${v.count.toLocaleString()} ${exclusionModuleLabel(m)}`).join(", ")}
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {excluded.map(([m, v]) => (
                  <li key={m}>
                    {exclusionModuleLabel(m)}: {v.examples.join("; ")}
                  </li>
                ))}
              </ul>
            </details>
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
              <h3 className="mb-2 font-medium text-indigo-900 dark:text-indigo-200">Key insights for this {REPORT_TYPES[reportType].name}</h3>
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

            <div className="mt-5 flex items-center gap-2">
              <button
                onClick={generateReport}
                disabled={generatingReport || !syncReady}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {generatingReport ? "Generating…" : `Generate ${REPORT_TYPES[reportType].name}`}
              </button>
            </div>
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
