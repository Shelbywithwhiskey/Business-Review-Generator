"use client";

import { useEffect, useState, use as usePromise } from "react";
import { Nav } from "@/components/Nav";

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

  useEffect(() => {
    fetch(`/api/reports/${id}`)
      .then((r) => r.json())
      .then((d) => setReport(d.report));
  }, [id]);

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

        <div className="space-y-10">
          {report.sections.map((section) => (
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
