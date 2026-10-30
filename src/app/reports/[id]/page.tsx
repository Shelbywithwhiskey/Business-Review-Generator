"use client";

import { useEffect, useState, use as usePromise } from "react";
import { Nav } from "@/components/Nav";
import type { AccountBrief, BriefItem } from "@/lib/reports/accountBrief";

const BRIEF_KEY = "account_brief";
const HEALTH_STYLE: Record<AccountBrief["health"]["status"], { label: string; cls: string }> = {
  healthy: { label: "Healthy", cls: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200" },
  steady: { label: "Steady", cls: "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200" },
  at_risk: { label: "At risk", cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
};

function BriefList({ title, items, tone }: { title: string; items: BriefItem[]; tone: string }) {
  return (
    <div>
      <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing flagged this period.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.headline} className="text-sm">
              <p className="font-medium">{it.headline}</p>
              <p className="text-neutral-600 dark:text-neutral-400">{it.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BriefPanel({ brief, busy, error, onGenerate }: { brief: AccountBrief | null; busy: boolean; error: string | null; onGenerate: () => void }) {
  return (
    <section className="mb-10 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Account Brief</h2>
        <button
          onClick={onGenerate}
          disabled={busy}
          className="no-print rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-neutral-700"
        >
          {busy ? "Building… (up to a minute)" : brief ? "Refresh brief" : "Generate brief"}
        </button>
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {!brief ? (
        <p className="text-sm text-neutral-500">
          An account manager&apos;s read of this account — what the business does, how it&apos;s using Zuper, wins, risks,
          opportunities and next steps. Built from the deck&apos;s findings and the company context on the customer page.
          Downloading the deck also builds it.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${HEALTH_STYLE[brief.health.status].cls}`}>
              {HEALTH_STYLE[brief.health.status].label}
            </span>
            <span className="text-sm text-neutral-600 dark:text-neutral-400">{brief.health.why}</span>
          </div>
          <p className="leading-relaxed">{brief.businessRead}</p>
          <div className="grid gap-6 sm:grid-cols-3">
            <BriefList title="What's working" items={brief.highlights} tone="text-green-700 dark:text-green-400" />
            <BriefList title="Risks" items={brief.risks} tone="text-red-700 dark:text-red-400" />
            <BriefList title="Opportunities" items={brief.opportunities} tone="text-orange-700 dark:text-orange-400" />
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Next actions</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {brief.nextActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ol>
            </div>
            {brief.questions.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Questions to ask</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {brief.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <p className="text-xs text-neutral-500">
            {brief.source === "ai" ? "Written by AI from the deck's findings; every number is checked against them." : "Built from the deck's ranked findings (AI unavailable)."}{" "}
            {brief.excludedNote} Built {new Date(brief.generatedAt).toLocaleString()} for {brief.periodLabel}.
          </p>
        </div>
      )}
    </section>
  );
}

interface Section {
  id: string;
  sectionKey: string;
  order: number;
  contentJson: unknown;
  narrativeText: string | null;
  recommendationText: string | null;
  isEdited: boolean;
}

interface ReportData {
  id: string;
  type: string;
  periodStart: string;
  periodEnd: string;
  customer: { name: string };
  sections: Section[];
}

const SECTION_TITLES: Record<string, string> = {
  executive_summary: "Executive Summary",
  jobs_performance: "Jobs Performance",
  invoice_performance: "Invoice Performance",
  quotes_performance: "Quotes & Proposals",
  parts_usage: "Parts, Products & Services Usage",
  technician_performance: "Technician Performance",
  key_insights: "Key Insights",
  opportunities: "Opportunities",
};

interface UsageEntry {
  name: string;
  jobCount: number;
  quantity: number;
  revenue: number;
}

interface UsageType {
  jobCount: number;
  distinctItems: number;
  totalRevenue: number;
  top: UsageEntry[];
}

interface LineItemUsage {
  parts: UsageType;
  products: UsageType;
  services: UsageType;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function UsageTables({ usage }: { usage: LineItemUsage }) {
  const groups: [string, UsageType][] = [
    ["Parts", usage.parts],
    ["Products", usage.products],
    ["Services", usage.services],
  ];
  return (
    <div className="mt-3 grid gap-4 sm:grid-cols-3">
      {groups.map(([label, group]) => {
        const maxJobs = Math.max(...group.top.map((t) => t.jobCount), 1);
        return (
          <div key={label} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <p className="font-medium">{label}</p>
            <p className="text-xs text-neutral-500">
              {money(group.totalRevenue)} · {group.distinctItems} items · {group.jobCount} jobs
            </p>
            {group.top.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-500">None recorded this period</p>
            ) : (
              <ol className="mt-2 space-y-2">
                {group.top.map((item) => (
                  <li key={item.name}>
                    <div className="flex justify-between gap-2">
                      <span className="truncate">{item.name}</span>
                      <span className="shrink-0 text-xs text-neutral-500">
                        {item.jobCount} jobs · {money(item.revenue)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded bg-neutral-100 dark:bg-neutral-800">
                      <div className="h-1.5 rounded bg-orange-600" style={{ width: `${(item.jobCount / maxJobs) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [report, setReport] = useState<ReportData | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  function loadReport() {
    return fetch(`/api/reports/${id}`)
      .then((r) => r.json())
      .then((d) => setReport(d.report));
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function generateBrief() {
    setBriefBusy(true);
    setBriefError(null);
    const res = await fetch(`/api/reports/${id}/brief`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setBriefError(data.error ?? "Could not build the brief.");
    }
    await loadReport();
    setBriefBusy(false);
  }

  function updateSectionLocal(sectionId: string, patch: Partial<Section>) {
    setReport((r) =>
      r ? { ...r, sections: r.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)) } : r
    );
  }

  async function saveSection(section: Section) {
    setSaving(section.id);
    await fetch(`/api/reports/${id}/sections/${section.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        narrativeText: section.narrativeText,
        recommendationText: section.recommendationText,
      }),
    });
    setSaving(null);
  }

  if (!report) {
    return (
      <div>
        <Nav />
        <main className="mx-auto max-w-4xl px-6 py-8 text-neutral-500">Loading…</main>
      </div>
    );
  }

  return (
    <div>
      <div className="no-print">
        <Nav />
      </div>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="no-print mb-6 flex justify-end gap-2">
          <a
            href={`/api/reports/${id}/export/ebr-pptx`}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Download EBR (PPTX)
          </a>
          <button
            onClick={() => window.print()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
          >
            Export / Print to PDF
          </button>
        </div>

        <header className="mb-8 border-b border-neutral-200 pb-6 dark:border-neutral-800">
          <p className="text-sm uppercase tracking-wide text-neutral-500">{report.type}</p>
          <h1 className="text-2xl font-semibold">{report.customer.name}</h1>
          <p className="text-sm text-neutral-500">
            {new Date(report.periodStart).toLocaleDateString()} – {new Date(report.periodEnd).toLocaleDateString()}
          </p>
        </header>

        <BriefPanel
          brief={(report.sections.find((s) => s.sectionKey === BRIEF_KEY)?.contentJson as AccountBrief | undefined) ?? null}
          busy={briefBusy}
          error={briefError}
          onGenerate={generateBrief}
        />

        <div className="space-y-10">
          {report.sections.filter((s) => s.sectionKey !== BRIEF_KEY).map((section) => (
            <section key={section.id}>
              <h2 className="mb-2 text-lg font-semibold">
                {SECTION_TITLES[section.sectionKey] ?? section.sectionKey}
              </h2>
              <textarea
                value={section.narrativeText ?? ""}
                onChange={(e) => updateSectionLocal(section.id, { narrativeText: e.target.value })}
                onBlur={() => saveSection(section)}
                rows={4}
                className="w-full resize-y rounded-md border border-transparent bg-transparent px-1 py-1 leading-relaxed hover:border-neutral-200 focus:border-neutral-300 focus:outline-none dark:hover:border-neutral-800 dark:focus:border-neutral-700"
              />
              {section.sectionKey === "parts_usage" && <UsageTables usage={section.contentJson as LineItemUsage} />}
              {section.recommendationText != null && (
                <div className="mt-2 rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-900">
                  <span className="font-medium">Recommendation: </span>
                  <textarea
                    value={section.recommendationText.replace(/^Recommendation:\s*/i, "")}
                    onChange={(e) =>
                      updateSectionLocal(section.id, { recommendationText: e.target.value })
                    }
                    onBlur={() => saveSection(section)}
                    rows={2}
                    className="mt-1 w-full resize-y bg-transparent focus:outline-none"
                  />
                </div>
              )}
              {saving === section.id && (
                <p className="no-print mt-1 text-xs text-neutral-400">Saving…</p>
              )}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
