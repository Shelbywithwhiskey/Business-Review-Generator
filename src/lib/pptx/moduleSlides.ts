import type JSZip from "jszip";
import type { DateRange } from "@/lib/zuper/modules";
import type { LineItemUsage } from "@/lib/analytics";
import type { WorkflowSummary } from "@/lib/reports/ebrMetrics";
import {
  computeAccountsDeepDive,
  computeExecutionDeepDive,
  computeInvoiceDeepDive,
  computeJobDeepDive,
  computeProjectsDeepDive,
  computeQuoteDeepDive,
  computeSyncInfo,
  computeWorkforceDeepDive,
  type AccountsDeepDive,
  type ExecutionDeepDive,
  type InvoiceDeepDive,
  type JobDeepDive,
  type ProjectsDeepDive,
  type QuoteDeepDive,
  type ScopeRow,
  type SyncInfo,
  type WorkforceDeepDive,
} from "@/lib/reports/moduleMetrics";
import { COLORS, CONTENT_W, CONTENT_X, ShapeWriter, fmtInt, fmtMoneyCompact, insertGeneratedSlide, run, truncate } from "./generatedSlide";
import { syncCaveat } from "./templateNotes";
import { computeCatalogAnalyses, computeCoverage, computeJobServiceDelivery, computePortalAndPay } from "@/lib/reports/catalogMetrics";
import { connectSlide, coverageSlides, insertChain, jobServiceSlide, moduleSlide, portalPaySlide, timeOnSiteSlide } from "./catalogSlides";
import { INVOICE_COLLECTION_DEFINITION, QUOTE_ACCEPTANCE_DEFINITION } from "@/lib/reports/classify";

const compact = (xs: (string | number | null | false | undefined)[]) => xs.filter((x): x is string => typeof x === "string" && x.length > 0);

// ---------------------------------------------------------------------------
// Module deep-dive slides (Jobs, Customers/Organizations/Properties, Team &
// time, Projects, Quotes, Invoices, Workflow executions, plus a Report Scope
// slide). Generated per export and spliced into the template's sections.
// Every slide states its exact date range in the subtitle and its data source
// + definition + sync date in the footer. Numbers are read straight off
// moduleMetrics — callout text never computes or rounds anything new.
// ---------------------------------------------------------------------------

// Validated categorical order (dataviz validator, light, white card surface): brand orange first.
const SERIES = ["FD5000", "2A78D6", "1BAF7A", "4A3AA7"];
// Status colors — reserved for run outcomes, always labelled (legend + data labels).
const GOOD = "0CA30C";
const CRITICAL = "D03B3B";
const NEUTRAL = "9CA3AF";

const KPI_Y = 1300000;
const BODY_Y = 2260000;
const BODY_H = 3520000;
const GAP = 150000;
const HALF_W = (CONTENT_W - GAP) / 2;

interface DeckContext {
  customerName: string;
  range: DateRange;
  sync: SyncInfo;
}

function syncLine(ctx: DeckContext): string {
  return syncCaveat(ctx.sync, ctx.range);
}

function fmtDate(d: Date | null | undefined): string {
  return d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
}

function periodText(range: DateRange): string {
  return `${fmtDate(range.start)} – ${fmtDate(range.end)}`;
}

function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtDuration(hours: number | null): string {
  if (hours == null) return "—";
  return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} days`;
}

function synced(ctx: DeckContext): string {
  return `Synced ${fmtDate(ctx.sync.completedAt)}`;
}

function plural(n: number, word: string): string {
  return `${fmtInt(n)} ${word}${n === 1 ? "" : "s"}`;
}

const left = { x: CONTENT_X, y: BODY_Y, cx: HALF_W, cy: BODY_H };
const right = { x: CONTENT_X + HALF_W + GAP, y: BODY_Y, cx: HALF_W, cy: BODY_H };

// ---- 1. Report scope ---------------------------------------------------------

function scopeSlide(ctx: DeckContext, rows: ScopeRow[]): ShapeWriter {
  const w = new ShapeWriter();
  w.header("Report Scope & Data Sources", `Report period ${periodText(ctx.range)}  ·  ${ctx.customerName}  ·  ${synced(ctx)}`);

  const y0 = 1300000;
  const h = 4480000;
  w.rect(CONTENT_X, y0, CONTENT_W, h, COLORS.white, { radius: 3000, border: COLORS.border });
  const cols = [
    { label: "MODULE", x: 0.02, w: 0.17 },
    { label: "IN THIS REPORT", x: 0.19, w: 0.27 },
    { label: "DATE BASIS", x: 0.46, w: 0.2 },
    { label: "NOTES", x: 0.66, w: 0.32 },
  ];
  const headerY = y0 + 120000;
  cols.forEach((c) => w.text(CONTENT_X + CONTENT_W * c.x, headerY, CONTENT_W * c.w, 220000, run(c.label, { sz: 800, color: COLORS.faint, bold: true }), { wrap: "none" }));
  const rowH = Math.min(330000, (h - 480000) / Math.max(rows.length, 1));
  rows.forEach((r, i) => {
    const y = y0 + 400000 + i * rowH;
    if (i % 2 === 0) w.rect(CONTENT_X + 60000, y - 20000, CONTENT_W - 120000, rowH, "F7F7F5");
    const cells = [
      run(r.module, { sz: 950, color: COLORS.ink, bold: true }),
      run(r.inPeriod, { sz: 950, color: COLORS.ink }),
      run(r.basis, { sz: 900, color: COLORS.muted }),
      run(r.note, { sz: 850, color: COLORS.muted }),
    ];
    cols.forEach((c, j) => w.text(CONTENT_X + CONTENT_W * c.x, y, CONTENT_W * c.w - 60000, rowH - 40000, cells[j], { anchor: "ctr" }));
  });

  const syncRange = ctx.sync.periodStart ? `${fmtDate(ctx.sync.periodStart)} – ${fmtDate(ctx.sync.periodEnd)}` : "no successful sync";
  w.insight(
    `Every figure in this deck is counted directly from ${ctx.customerName}'s Zuper data — nothing is estimated. Last sync covered ${syncRange}` +
      (ctx.sync.periodOutsideSync ? ` — this report's period extends beyond it, so re-sync for complete figures.` : ".") +
      (ctx.sync.notes ? ` Sync notes: ${ctx.sync.notes}.` : "")
  );
  w.footer("Each slide's subtitle states its date range; its footer states the data source and how the figures are defined.");
  w.notes = {
    purpose: "What the deck covers: every module synced from Zuper, what it contributes for this period, and which date each figure is counted by.",
    talkingPoints: [
      "Use this slide to set trust: every number that follows is counted from the customer's own Zuper records — nothing is estimated or benchmarked.",
      "If the customer questions a figure later, come back here for the date basis.",
    ],
    caveats: compact([syncLine(ctx), ctx.sync.notes && `Modules skipped or partially synced: ${ctx.sync.notes}.`]),
  };
  return w;
}

function scopeRows(
  jobs: JobDeepDive,
  usage: LineItemUsage,
  accounts: AccountsDeepDive,
  team: WorkforceDeepDive,
  projects: ProjectsDeepDive,
  quotes: QuoteDeepDive,
  invoices: InvoiceDeepDive,
  workflows: WorkflowSummary,
  exec: ExecutionDeepDive
): ScopeRow[] {
  return [
    { module: "Jobs", inPeriod: `${fmtInt(jobs.created)} created · ${fmtInt(jobs.completed)} completed`, basis: "Job created date", note: `Completed = Completed or Closed status · ${pct(jobs.recurringShare, 0)} recurring` },
    { module: "Parts & services", inPeriod: `${fmtInt(usage.jobsWithLineItems)} jobs with line items`, basis: "Job created date", note: `${pct(usage.attachRate, 0)} of jobs · ${fmtMoneyCompact(usage.totalRevenue)} billed on jobs` },
    { module: "Quotes", inPeriod: `${fmtInt(quotes.count)} created · ${fmtMoneyCompact(quotes.value)}`, basis: "Quote date", note: `${fmtInt(quotes.convertedCount)} approved / converted` },
    { module: "Invoices", inPeriod: `${fmtInt(invoices.count)} issued · ${fmtMoneyCompact(invoices.invoiced)}`, basis: "Invoice date", note: `Aging measured against each invoice's due date, as of today` },
    { module: "Payments", inPeriod: `${fmtMoneyCompact(invoices.paymentsTotal)} received`, basis: "Payment date", note: `${pct(invoices.onlineShare, 0)} collected online` },
    { module: "Customers", inPeriod: `${fmtInt(accounts.customers.total)} total · ${fmtInt(accounts.customers.newInPeriod)} new`, basis: "Customer created date", note: "Lifetime value & receivables are Zuper's all-time figures" },
    {
      module: "Organizations",
      inPeriod: accounts.organizations.total ? `${fmtInt(accounts.organizations.total)} total · ${fmtInt(accounts.organizations.newInPeriod)} new` : "Not in use",
      basis: "Organization created date",
      note: accounts.jobsWithOrganization ? `${fmtInt(accounts.jobsWithOrganization)} period jobs linked to an organization` : "—",
    },
    {
      module: "Properties",
      inPeriod: accounts.properties.total ? `${fmtInt(accounts.properties.total)} total · ${fmtInt(accounts.properties.newInPeriod)} new` : "Not in use",
      basis: "Property created date",
      note: "Jobs per property is Zuper's all-time count",
    },
    { module: "Projects", inPeriod: projects.total ? `${fmtInt(projects.total)} total · ${fmtInt(projects.createdInPeriod)} new` : "Not in use", basis: "Project created date", note: "—" },
    {
      module: "Team & time",
      inPeriod: `${fmtInt(team.teamSize)} active users`,
      basis: "Job created date",
      note: team.timesheetEvents ? `${fmtInt(team.timesheetHours)} hours clocked (timesheets)` : "Timesheets / time logs not in use",
    },
    { module: "Workflows", inPeriod: `${fmtInt(workflows.live)} live of ${fmtInt(workflows.total)}`, basis: "Current configuration", note: `${fmtInt(workflows.liveSteps)} automated steps` },
    {
      module: "Workflow runs",
      inPeriod: exec.available ? `${fmtInt(exec.total)} executions` : "Not synced yet",
      basis: exec.available ? `Run date, ${fmtDate(exec.countedFrom)} – ${fmtDate(exec.countedTo)}` : "—",
      note: exec.available ? `Zuper keeps run history from ${fmtDate(exec.retainedFrom)}` : "Re-sync to include execution counts",
    },
  ];
}

// ---- 2–3. Jobs -------------------------------------------------------------------

function jobsVolumeSlide(ctx: DeckContext, j: JobDeepDive): ShapeWriter {
  const w = new ShapeWriter();
  w.header("Jobs — Volume & Mix", `Jobs created ${periodText(ctx.range)}  ·  ${fmtInt(j.created)} jobs`);
  w.kpis(KPI_Y, [
    { value: fmtInt(j.created), label: "Jobs created" },
    { value: fmtInt(j.completed), label: `Completed (${pct(j.completionRate)})` },
    { value: fmtInt(j.cancelled), label: "Cancelled" },
    { value: pct(j.recurringShare, 0), label: "Recurring jobs" },
    { value: fmtInt(j.unscheduledOpen), label: "Open & not yet scheduled", alert: j.unscheduledOpen > 0 && j.unscheduledOpen / Math.max(j.created, 1) > 0.25 },
  ]);

  const a = w.card(left.x, left.y, left.cx, left.cy, "JOBS CREATED VS COMPLETED, BY MONTH");
  if (j.monthly.some((m) => m.created || m.completed)) {
    w.chart(a.x, a.y, a.cx, a.cy, {
      kind: "column",
      categories: j.monthly.map((m) => m.label),
      series: [
        { name: "Created", values: j.monthly.map((m) => m.created), color: SERIES[0] },
        { name: "Completed", values: j.monthly.map((m) => m.completed), color: SERIES[1] },
      ],
    });
  } else w.empty(a, "No jobs in this period");

  const b = w.card(right.x, right.y, right.cx, right.cy, "JOB CATEGORIES — CREATED VS COMPLETED");
  if (j.categories.length) {
    w.chart(b.x, b.y, b.cx, b.cy, {
      kind: "bar",
      categories: j.categories.map((c) => truncate(c.name, 26)),
      series: [
        { name: "Created", values: j.categories.map((c) => c.created), color: SERIES[0] },
        { name: "Completed", values: j.categories.map((c) => c.completed), color: SERIES[1] },
      ],
    });
  } else w.empty(b, "No job categories recorded");

  const top = j.categories[0];
  const busiest = [...j.monthly].sort((x, y) => y.created - x.created)[0];
  w.insight(
    j.created
      ? `${pct(j.completionRate)} of the ${fmtInt(j.created)} jobs created this period are completed` +
          (top ? `; ${top.name} is the largest category (${fmtInt(top.created)} jobs, ${pct(top.created / j.created, 0)})` : "") +
          (busiest?.created ? `; busiest month was ${busiest.label} with ${fmtInt(busiest.created)} jobs created` : "") +
          (j.unscheduledOpen ? `. ${plural(j.unscheduledOpen, "open job")} still ${j.unscheduledOpen === 1 ? "has" : "have"} no schedule.` : ".")
      : "No jobs were created in this period."
  );
  w.footer(`Source: Zuper Jobs · jobs created in the period; monthly "Completed" = jobs completed in that month · ${synced(ctx)}`);
  w.notes = {
    purpose: "Job volume and mix: how much work was created, how much is done, and which job categories drive it.",
    callouts: compact([
      j.created > 0 && `${pct(j.completionRate)} of the ${fmtInt(j.created)} jobs created are completed; ${fmtInt(j.cancelled)} were cancelled.`,
      top && `${top.name} is the largest category (${fmtInt(top.created)} jobs, ${pct(top.created / Math.max(j.created, 1), 0)}).`,
      busiest?.created && `Busiest month: ${busiest.label} (${fmtInt(busiest.created)} jobs created).`,
      j.unscheduledOpen > 0 && `${plural(j.unscheduledOpen, "open job")} ${j.unscheduledOpen === 1 ? "has" : "have"} no schedule yet${j.unscheduledOpen / Math.max(j.created, 1) > 0.25 ? " — over a quarter of the period's jobs, worth raising as a dispatch backlog" : ""}.`,
      j.highPriority > 0 && `${plural(j.highPriority, "job")} marked high or urgent priority.`,
    ]),
    metrics: [
      { label: "Jobs created", value: fmtInt(j.created), definition: "Jobs whose created date falls in the period.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Completed", value: fmtInt(j.completed), definition: "Of those, jobs whose current status type is Completed or Closed.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Cancelled", value: fmtInt(j.cancelled), definition: "Of those, jobs whose current status type is Cancelled or Declined.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Recurring jobs", value: pct(j.recurringShare, 0), definition: "Share of jobs created from a recurrence (is_recurrence).", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Open & not yet scheduled", value: fmtInt(j.unscheduledOpen), definition: "Jobs created in the period that are not completed/cancelled and have no schedule (is_scheduled = false).", source: "Zuper Jobs", evidence: "Current state" },
      { label: "Monthly chart", definition: "Created = jobs created that month; Completed = jobs whose completion status entry falls in that month (can include jobs created earlier).", source: "Zuper Jobs status history", evidence: "Observed activity" },
    ],
    caveats: [syncLine(ctx)],
  };
  return w;
}

function jobsLifecycleSlide(ctx: DeckContext, j: JobDeepDive): ShapeWriter {
  const w = new ShapeWriter();
  const openTotal = j.openByStatus.reduce((s, o) => s + o.count, 0);
  w.header("Jobs — Lifecycle & Bottlenecks", `Jobs created ${periodText(ctx.range)}  ·  status history of ${plural(j.created, "job")}`);
  w.kpis(KPI_Y, [
    { value: fmtDuration(j.medianHoursToSchedule), label: "Median: created → scheduled" },
    { value: fmtDuration(j.medianHoursScheduledToComplete), label: "Median: scheduled → completed" },
    { value: j.medianDaysCreatedToComplete == null ? "—" : `${j.medianDaysCreatedToComplete.toFixed(1)} days`, label: "Median: created → completed" },
    { value: fmtInt(openTotal), label: "Still open from this period", alert: j.created > 0 && openTotal / j.created > 0.5 },
  ]);

  const a = w.card(left.x, left.y, left.cx, left.cy, "OPEN JOBS BY CURRENT STATUS");
  if (j.openByStatus.length) {
    w.chart(a.x, a.y, a.cx, a.cy, {
      kind: "bar",
      categories: j.openByStatus.map((o) => truncate(o.name, 28)),
      series: [{ name: "Open jobs", values: j.openByStatus.map((o) => o.count), color: SERIES[0] }],
    });
  } else w.empty(a, "No open jobs from this period");

  const b = w.card(right.x, right.y, right.cx, right.cy, "AVERAGE HOURS SPENT IN EACH STATUS");
  if (j.timeInStatus.length) {
    w.chart(b.x, b.y, b.cx, b.cy, {
      kind: "bar",
      categories: j.timeInStatus.map((t) => truncate(t.name, 28)),
      series: [{ name: "Avg hours in status", values: j.timeInStatus.map((t) => Math.round(t.avgHours * 10) / 10), color: SERIES[1] }],
      numberFormat: "#,##0.0",
    });
  } else w.empty(b, "Not enough status history yet");

  const slowest = j.timeInStatus[0];
  const biggestOpen = j.openByStatus[0];
  w.insight(
    [
      slowest ? `Jobs spend the longest in "${slowest.name}" — ${fmtDuration(slowest.avgHours)} on average across ${plural(slowest.jobs, "job")}` : null,
      biggestOpen ? `the largest open backlog is "${biggestOpen.name}" (${plural(biggestOpen.count, "job")}, median age ${biggestOpen.medianAgeDays?.toFixed(0) ?? "—"} days)` : null,
      j.medianHoursToSchedule != null ? `half of scheduled jobs were scheduled within ${fmtDuration(j.medianHoursToSchedule)} of creation` : null,
    ]
      .filter(Boolean)
      .join("; ") + "."
  );
  w.footer(`Source: Zuper Jobs status history (time on each status, as recorded by Zuper) · ${plural(j.lifecycleSample, "scheduled job")} measured · ages as of today · ${synced(ctx)}`);
  w.notes = {
    purpose: "Where jobs slow down: time from creation to schedule to completion, which statuses hold jobs longest, and what is still open.",
    callouts: compact([
      slowest && `Longest status: "${slowest.name}" — ${fmtDuration(slowest.avgHours)} on average across ${plural(slowest.jobs, "job")}.`,
      biggestOpen && `Largest open backlog: "${biggestOpen.name}" with ${plural(biggestOpen.count, "job")} (median age ${biggestOpen.medianAgeDays?.toFixed(0) ?? "—"} days).`,
      j.medianHoursToSchedule != null && `Median time from job created to scheduled: ${fmtDuration(j.medianHoursToSchedule)}.`,
      j.medianDaysCreatedToComplete != null && `Median time from created to completed: ${j.medianDaysCreatedToComplete.toFixed(1)} days.`,
    ]),
    talkingPoints: ["Ask what happens in the slowest status — waiting on parts, approvals or customer response each point to a different fix (inventory, workflow automation, customer reminders)."],
    metrics: [
      { label: "Median created → scheduled", value: fmtDuration(j.medianHoursToSchedule), definition: "Hours from job creation to its first Scheduled status entry, median across jobs that were scheduled.", source: "Zuper Jobs status history", evidence: "Observed activity" },
      { label: "Median scheduled → completed", value: fmtDuration(j.medianHoursScheduledToComplete), definition: "Hours from first Scheduled to first Completed status entry.", source: "Zuper Jobs status history", evidence: "Observed activity" },
      { label: "Median created → completed", value: j.medianDaysCreatedToComplete == null ? "—" : `${j.medianDaysCreatedToComplete.toFixed(1)} days`, definition: "Days from creation to the Completed status entry.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Still open from this period", value: fmtInt(openTotal), definition: "Jobs created in the period whose current status isn't completed or cancelled, grouped by current status; age = days since creation as of today.", source: "Zuper Jobs", evidence: "Current state" },
      { label: "Average hours in each status", definition: "Zuper's time_on_status for every status a job has already left (the current status is excluded because its clock is still running); statuses seen on fewer than 3 jobs are hidden.", source: "Zuper Jobs status history", evidence: "Observed activity" },
    ],
    caveats: [`${plural(j.lifecycleSample, "scheduled job")} had usable status history.`, "Waiting time in a status is elapsed time, not work time.", syncLine(ctx)],
  };
  return w;
}

// ---- 4. Customers, organizations, properties -----------------------------------------

function accountsSlide(ctx: DeckContext, a: AccountsDeepDive): ShapeWriter {
  const w = new ShapeWriter();
  w.header("Customers, Organizations & Properties", `New = created ${periodText(ctx.range)}  ·  totals are all-time`);
  w.kpis(KPI_Y, [
    { value: fmtInt(a.customers.total), label: `Customers (${fmtInt(a.customers.newInPeriod)} new)` },
    { value: a.organizations.total ? fmtInt(a.organizations.total) : "—", label: a.organizations.total ? `Organizations (${fmtInt(a.organizations.newInPeriod)} new)` : "Organizations not in use" },
    { value: a.properties.total ? fmtInt(a.properties.total) : "—", label: a.properties.total ? `Properties (${fmtInt(a.properties.newInPeriod)} new)` : "Properties not in use" },
    { value: pct(a.top5LtvShare, 0), label: "Lifetime value in top 5 customers", alert: a.top5LtvShare > 0.5 },
    { value: fmtMoneyCompact(a.totalReceivables), label: "Receivables (all customers)" },
  ]);

  const orgCard = w.card(left.x, left.y, left.cx, left.cy, a.topOrganizationsByJobs.length ? "TOP ORGANIZATIONS BY JOBS THIS PERIOD" : "TOP CUSTOMERS BY LIFETIME VALUE");
  if (a.topOrganizationsByJobs.length) {
    w.chart(orgCard.x, orgCard.y, orgCard.cx, orgCard.cy, {
      kind: "bar",
      categories: a.topOrganizationsByJobs.map((o) => truncate(o.name, 28)),
      series: [{ name: "Jobs", values: a.topOrganizationsByJobs.map((o) => o.jobs), color: SERIES[0] }],
    });
  } else if (a.topCustomersByLtv.length) {
    w.chart(orgCard.x, orgCard.y, orgCard.cx, orgCard.cy, {
      kind: "bar",
      categories: a.topCustomersByLtv.map((c) => truncate(c.name, 28)),
      series: [{ name: "Lifetime value", values: a.topCustomersByLtv.map((c) => Math.round(c.ltv)), color: SERIES[0] }],
      numberFormat: "$#,##0",
    });
  } else w.empty(orgCard, "No customer activity recorded");

  const propCard = w.card(right.x, right.y, right.cx, right.cy, a.topPropertiesByJobs.length ? "MOST-SERVICED PROPERTIES (ALL-TIME JOBS)" : "CUSTOMERS BY CATEGORY");
  if (a.topPropertiesByJobs.length) {
    w.chart(propCard.x, propCard.y, propCard.cx, propCard.cy, {
      kind: "bar",
      categories: a.topPropertiesByJobs.map((p) => truncate(p.name, 28)),
      series: [{ name: "Jobs (all-time)", values: a.topPropertiesByJobs.map((p) => p.jobs), color: SERIES[1] }],
    });
  } else if (a.customerCategories.length > 1) {
    w.chart(propCard.x, propCard.y, propCard.cx, propCard.cy, {
      kind: "doughnut",
      categories: a.customerCategories.map((c) => c.name),
      series: [{ name: "Customers", values: a.customerCategories.map((c) => c.count), color: SERIES[0] }],
      pointColors: SERIES,
    });
  } else w.empty(propCard, "Properties are not in use on this account");

  const topOrg = a.topOrganizationsByJobs[0];
  const topProp = a.topPropertiesByJobs[0];
  w.insight(
    [
      topOrg && a.jobsWithOrganization ? `${topOrg.name} generated the most work this period (${plural(topOrg.jobs, "job")}, ${pct(topOrg.jobs / a.jobsWithOrganization, 0)} of organization-linked jobs)` : null,
      topProp ? `${topProp.name} is the most-serviced property (${plural(topProp.jobs, "job")} all-time)` : null,
      `the top 5 customers hold ${pct(a.top5LtvShare, 0)} of lifetime value`,
      `${pct(a.customers.repeatShare, 0)} of customers have booked more than one job`,
    ]
      .filter(Boolean)
      .join("; ") + "."
  );
  w.footer(`Source: Zuper Customers, Organizations & Properties · "new" by created date · lifetime value, receivables and property job counts are Zuper's all-time figures · ${synced(ctx)}`);
  w.notes = {
    purpose: "Who the work is for: the customer base, B2B organizations and service properties, and how concentrated the value is.",
    callouts: compact([
      `${fmtInt(a.customers.newInPeriod)} new customers were added this period (${fmtInt(a.customers.total)} total).`,
      topOrg && a.jobsWithOrganization && `${topOrg.name} generated the most work: ${plural(topOrg.jobs, "job")} (${pct(topOrg.jobs / a.jobsWithOrganization, 0)} of organization-linked jobs).`,
      a.top5LtvShare > 0.5 && `Concentration: the top 5 customers hold ${pct(a.top5LtvShare, 0)} of lifetime value — losing one would be felt.`,
      `${pct(a.customers.repeatShare, 0)} of customers have booked more than one job.`,
      a.totalReceivables > 0 && `${fmtMoneyCompact(a.totalReceivables)} in receivables across all customers (Zuper's figure).`,
    ]),
    metrics: [
      { label: "Customers", value: fmtInt(a.customers.total), definition: "All end customers on the account; new = created in the period.", source: "Zuper Customers", evidence: "Current state" },
      { label: "Organizations", value: fmtInt(a.organizations.total), definition: "B2B organizations on the account; new = created in the period.", source: "Zuper Organizations", evidence: "Current state" },
      { label: "Properties", value: fmtInt(a.properties.total), definition: "Service locations on the account; new = created in the period.", source: "Zuper Properties", evidence: "Current state" },
      { label: "Lifetime value in top 5 customers", value: pct(a.top5LtvShare, 0), definition: "Sum of Zuper's lifetime value (accounts.ltv) for the 5 highest customers ÷ all customers.", source: "Zuper Customers", evidence: "Current state" },
      { label: "Receivables", value: fmtMoneyCompact(a.totalReceivables), definition: "Sum of Zuper's receivables figure across all customers (all-time, not just this period).", source: "Zuper Customers", evidence: "Current state" },
      { label: "Top organizations chart", definition: "Jobs created in the period linked to each organization.", source: "Zuper Jobs + Organizations", evidence: "Observed activity" },
      { label: "Most-serviced properties", definition: "Zuper's all-time job count per property (no_of_jobs).", source: "Zuper Properties", evidence: "Current state" },
    ],
    caveats: ["Lifetime value and receivables are Zuper's own all-time figures, not limited to the report period.", syncLine(ctx)],
  };
  return w;
}

// ---- 5. Team & time ------------------------------------------------------------------

function workforceSlide(ctx: DeckContext, t: WorkforceDeepDive, jobsCreated: number): ShapeWriter {
  const w = new ShapeWriter();
  w.header("Team, Workload & Time Tracking", `Jobs created ${periodText(ctx.range)}  ·  ${plural(t.teamSize, "active user")}`);
  const assignedShare = jobsCreated ? t.jobsAssigned / jobsCreated : 0;
  w.kpis(KPI_Y, [
    { value: fmtInt(t.teamSize), label: "Active users" },
    { value: fmtInt(t.loggedInThisPeriod), label: "Logged in during / since period" },
    { value: pct(assignedShare, 0), label: "Jobs with an assigned technician" },
    { value: fmtInt(t.jobsUnassigned), label: "Jobs without an assignee", alert: jobsCreated > 0 && t.jobsUnassigned / jobsCreated > 0.2 },
    { value: t.timesheetEvents ? `${fmtInt(t.timesheetHours)} h` : "Not tracked", label: "Hours clocked (timesheets)", alert: !t.timesheetEvents },
  ]);

  const wide = { x: CONTENT_X, y: BODY_Y, cx: CONTENT_W * 0.64, cy: BODY_H };
  const a = w.card(wide.x, wide.y, wide.cx, wide.cy, "JOBS PER TECHNICIAN — ASSIGNED VS COMPLETED (TOP 10)");
  if (t.byTechnician.length) {
    w.chart(a.x, a.y, a.cx, a.cy, {
      kind: "bar",
      categories: t.byTechnician.map((p) => truncate(p.name, 24)),
      series: [
        { name: "Assigned", values: t.byTechnician.map((p) => p.assigned), color: SERIES[1] },
        { name: "Completed", values: t.byTechnician.map((p) => p.completed), color: SERIES[0] },
      ],
    });
  } else w.empty(a, "No jobs were assigned to technicians in this period");

  const nx = CONTENT_X + wide.cx + GAP;
  const b = w.card(nx, BODY_Y, CONTENT_W - wide.cx - GAP, BODY_H, "TIME TRACKING");
  const message = t.timesheetEvents
    ? `${plural(t.timesheetEvents, "clock-in/out event")} recorded, totalling ${fmtInt(t.timesheetHours)} hours on the clock in this period.`
    : "No timesheet clock-ins or job time logs were recorded in this period. Turning on clock-in/out and job time logging unlocks utilization, overtime and labor-cost-per-job reporting.";
  w.text(b.x + 60000, b.y + 100000, b.cx - 120000, b.cy - 200000, run(message, { sz: 1100, color: COLORS.ink }));

  const top = t.byTechnician[0];
  const topShare = top && t.jobsAssigned ? top.assigned / t.jobsAssigned : 0;
  w.insight(
    [
      top ? `${top.name} carried the most work (${plural(top.assigned, "job")} assigned, ${fmtInt(top.completed)} completed — ${pct(topShare, 0)} of all assigned jobs)` : null,
      t.jobsUnassigned ? `${plural(t.jobsUnassigned, "job")} from this period ${t.jobsUnassigned === 1 ? "has" : "have"} no technician assigned` : null,
      t.timesheetEvents ? null : "time tracking is not in use",
    ]
      .filter(Boolean)
      .join("; ") + "."
  );
  w.footer(`Source: Zuper Jobs (primary assignee) & Timesheets · jobs created in the period · ${synced(ctx)}`);
  w.notes = {
    purpose: "Who is doing the work: team size, workload per technician, unassigned jobs and time tracking.",
    callouts: compact([
      top && `${top.name} carried the most work: ${plural(top.assigned, "job")} assigned, ${fmtInt(top.completed)} completed (${pct(topShare, 0)} of assigned jobs).`,
      topShare > 0.35 && "One person carries over a third of assigned jobs — a key-person dependency worth raising.",
      t.jobsUnassigned > 0 && `${plural(t.jobsUnassigned, "job")} from this period ${t.jobsUnassigned === 1 ? "has" : "have"} no technician assigned.`,
      t.teamSize > t.loggedInThisPeriod && `${fmtInt(t.teamSize - t.loggedInThisPeriod)} active users haven't logged in during or since the period — confirm the seats are still needed.`,
      !t.timesheetEvents && "Time tracking isn't in use; turning on clock-in/out unlocks utilization and labor-cost reporting.",
    ]),
    metrics: [
      { label: "Active users", value: fmtInt(t.teamSize), definition: "Users marked active across the account's teams.", source: "Zuper Teams", evidence: "Current state" },
      { label: "Logged in during / since period", value: fmtInt(t.loggedInThisPeriod), definition: "Active users whose last login is on or after the period start.", source: "Zuper Teams (last_login_at)", evidence: "Current state" },
      { label: "Jobs with an assigned technician", value: pct(assignedShare, 0), definition: "Jobs created in the period with a primary assignee ÷ all jobs created in the period.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Jobs per technician", definition: "Jobs created in the period by primary assignee; completed = now Completed/Closed.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Hours clocked", value: t.timesheetEvents ? `${fmtInt(t.timesheetHours)} h` : "Not tracked", definition: "Paired clock-in → clock-out timesheet events per user in the period.", source: "Zuper Timesheets", evidence: t.timesheetEvents ? "Observed activity" : "Insufficient data" },
    ],
    caveats: ["Only the primary assignee is counted per job; helpers on multi-tech jobs aren't credited.", syncLine(ctx)],
  };
  return w;
}

// ---- 6. Projects (only when the account uses them) --------------------------------

function projectsSlide(ctx: DeckContext, p: ProjectsDeepDive): ShapeWriter {
  const w = new ShapeWriter();
  w.header("Projects", `Projects created ${periodText(ctx.range)}  ·  ${plural(p.total, "project")} all-time`);
  w.kpis(KPI_Y, [
    { value: fmtInt(p.total), label: "Projects (all-time)" },
    { value: fmtInt(p.createdInPeriod), label: "Created this period" },
  ]);
  const a = w.card(CONTENT_X, BODY_Y, CONTENT_W, BODY_H, "PROJECTS CREATED THIS PERIOD, BY STATUS");
  if (p.byStatus.length) {
    w.chart(a.x, a.y, a.cx, a.cy, { kind: "bar", categories: p.byStatus.map((s) => truncate(s.name, 30)), series: [{ name: "Projects", values: p.byStatus.map((s) => s.count), color: SERIES[0] }] });
  } else w.empty(a, "No projects were created in this period");
  w.insight(p.byStatus[0] ? `${plural(p.createdInPeriod, "project")} created this period; the most common status is "${p.byStatus[0].name}" (${fmtInt(p.byStatus[0].count)}).` : `${plural(p.total, "project")} on the account; none were created this period.`);
  w.footer(`Source: Zuper Projects · by project created date · ${synced(ctx)}`);
  w.notes = {
    purpose: "Multi-job projects on the account and their current status.",
    callouts: compact([p.byStatus[0] && `Most common status for projects created this period: "${p.byStatus[0].name}" (${fmtInt(p.byStatus[0].count)}).`]),
    metrics: [
      { label: "Projects (all-time)", value: fmtInt(p.total), definition: "Every project on the account.", source: "Zuper Projects", evidence: "Current state" },
      { label: "Created this period", value: fmtInt(p.createdInPeriod), definition: "Projects whose created date falls in the period.", source: "Zuper Projects", evidence: "Observed activity" },
    ],
    caveats: ["Project fields were mapped without a populated test account — double-check statuses against Zuper before presenting.", syncLine(ctx)],
  };
  return w;
}

// ---- 7. Quotes -----------------------------------------------------------------------

function quotesSlide(ctx: DeckContext, q: QuoteDeepDive): ShapeWriter {
  const w = new ShapeWriter();
  w.header("Quotes — Pipeline & Conversion", `Quotes created ${periodText(ctx.range)}  ·  ${plural(q.count, "quote")} · ${fmtMoneyCompact(q.value)}`);
  w.kpis(KPI_Y, [
    { value: fmtInt(q.count), label: `Quotes created (${fmtMoneyCompact(q.value)})` },
    { value: pct(q.conversionRate), label: `Approved / converted (${fmtInt(q.convertedCount)})` },
    { value: fmtMoneyCompact(q.convertedValue), label: "Value won" },
    { value: q.medianDaysToAccept == null ? "—" : `${q.medianDaysToAccept.toFixed(1)} days`, label: "Median days to approval" },
    { value: fmtInt(q.expiredOpen), label: "Expired without approval", alert: q.expiredOpen > 0 },
  ]);

  const a = w.card(left.x, left.y, left.cx, left.cy, "QUOTES BY STATUS");
  if (q.byStatus.length) {
    w.chart(a.x, a.y, a.cx, a.cy, {
      kind: "bar",
      categories: q.byStatus.map((s) => s.name.replace(/_/g, " ")),
      series: [{ name: "Quotes", values: q.byStatus.map((s) => s.count), color: SERIES[0] }],
    });
  } else w.empty(a, "No quotes created in this period");

  const b = w.card(right.x, right.y, right.cx, right.cy, "QUOTES CREATED VS APPROVED, BY MONTH");
  if (q.monthly.some((m) => m.created)) {
    w.chart(b.x, b.y, b.cx, b.cy, {
      kind: "column",
      categories: q.monthly.map((m) => m.label),
      series: [
        { name: "Created", values: q.monthly.map((m) => m.created), color: SERIES[0] },
        { name: "Approved / converted", values: q.monthly.map((m) => m.converted), color: SERIES[1] },
      ],
    });
  } else w.empty(b, "No quotes created in this period");

  const topStatus = q.byStatus[0];
  w.insight(
    q.count
      ? `${pct(q.conversionRate)} of ${plural(q.count, "quote")} were approved or converted, winning ${fmtMoneyCompact(q.convertedValue)}` +
          (topStatus ? `; the most common status is ${topStatus.name.replace(/_/g, " ").toLowerCase()} (${fmtInt(topStatus.count)})` : "") +
          (q.medianDaysToAccept != null ? `; approvals took a median ${q.medianDaysToAccept.toFixed(1)} days` : "") +
          "."
      : "No quotes were created in this period — quoting in Zuper would make pipeline and win-rate visible here."
  );
  w.footer(`Source: Zuper Quotes (estimates) · by quote date · approval time from sent (or quote) date to acceptance · ${synced(ctx)}`);
  w.notes = {
    purpose: "Quote pipeline: how many quotes went out, how many were won, and how quickly.",
    callouts: compact([
      q.sent > 0 && `${pct(q.conversionRate)} of ${plural(q.sent, "sent quote")} were accepted, worth ${fmtMoneyCompact(q.convertedValue)}.`,
      q.medianDaysToAccept != null && `Accepted quotes took a median ${q.medianDaysToAccept.toFixed(1)} days from sent to accepted.`,
      q.expiredOpen > 0 && `${plural(q.expiredOpen, "quote")} expired without approval — automated reminders before expiry could recover some.`,
      topStatus && `Most common status: ${topStatus.name.replace(/_/g, " ").toLowerCase()} (${fmtInt(topStatus.count)}).`,
    ]),
    metrics: [
      { label: "Quotes created", value: `${fmtInt(q.count)} · ${fmtMoneyCompact(q.value)}`, definition: "Quotes dated in the period, any status.", source: "Zuper Quotes", evidence: "Observed activity" },
      { label: "Approved / converted", value: `${pct(q.conversionRate)} (${fmtInt(q.convertedCount)})`, definition: QUOTE_ACCEPTANCE_DEFINITION, source: "Zuper Quotes", evidence: "Observed activity" },
      { label: "Value won", value: fmtMoneyCompact(q.convertedValue), definition: "Total value of accepted quotes.", source: "Zuper Quotes", evidence: "Observed activity" },
      { label: "Median days to approval", value: q.medianDaysToAccept == null ? "—" : `${q.medianDaysToAccept.toFixed(1)} days`, definition: `Days from sent date (or quote date if never sent) to accepted/converted date; ${plural(q.acceptSample, "quote")} measured.`, source: "Zuper Quotes", evidence: "Observed activity" },
      { label: "Expired without approval", value: fmtInt(q.expiredOpen), definition: "Quotes flagged expired and not converted.", source: "Zuper Quotes", evidence: "Current state" },
    ],
    caveats: ["Accepted quote value is won work, not revenue until invoiced and paid.", "Quotes from late in the period are still being decided.", syncLine(ctx)],
  };
  return w;
}

// ---- 8. Invoices & collections ----------------------------------------------------------

function invoicesSlide(ctx: DeckContext, inv: InvoiceDeepDive): ShapeWriter {
  const w = new ShapeWriter();
  const over60 = inv.aging.filter((b) => b.label === "61–90 days" || b.label === "90+ days").reduce((s, b) => s + b.amount, 0);
  w.header("Invoices — Aging & Collections", `Invoices issued ${periodText(ctx.range)}  ·  payments received in the same period`);
  w.kpis(KPI_Y, [
    { value: fmtMoneyCompact(inv.invoiced), label: `Invoiced (${plural(inv.count, "invoice")})` },
    { value: fmtMoneyCompact(inv.collected), label: `Collected (${pct(inv.invoiced ? inv.collected / inv.invoiced : 0, 0)})` },
    { value: fmtMoneyCompact(over60), label: "Outstanding > 60 days past due", alert: over60 > 0 },
    { value: inv.medianDaysToPay == null ? "—" : `${inv.medianDaysToPay.toFixed(0)} days`, label: "Median days to get paid" },
    { value: pct(inv.onlineShare, 0), label: "Payments collected online", alert: inv.paymentsTotal > 0 && inv.onlineShare < 0.2 },
  ]);

  const a = w.card(left.x, left.y, left.cx, left.cy, "OUTSTANDING BALANCE BY DAYS PAST DUE");
  if (inv.aging.some((b) => b.amount > 0)) {
    w.chart(a.x, a.y, a.cx, a.cy, {
      kind: "column",
      categories: inv.aging.map((b) => b.label),
      series: [{ name: "Outstanding", values: inv.aging.map((b) => Math.round(b.amount)), color: SERIES[0] }],
      numberFormat: "$#,##0",
    });
  } else w.empty(a, "Nothing outstanding on this period's invoices");

  const b = w.card(right.x, right.y, right.cx, right.cy, "PAYMENTS RECEIVED BY METHOD");
  if (inv.paymentModes.length) {
    w.chart(b.x, b.y, b.cx, b.cy, {
      kind: "bar",
      categories: inv.paymentModes.map((m) => truncate(m.name, 24)),
      series: [{ name: "Amount", values: inv.paymentModes.map((m) => Math.round(m.amount)), color: SERIES[1] }],
      numberFormat: "$#,##0",
    });
  } else w.empty(b, "No payments recorded in this period");

  w.insight(
    `${fmtMoneyCompact(inv.outstanding)} of ${fmtMoneyCompact(inv.invoiced)} invoiced is still outstanding` +
      (over60 ? `, including ${fmtMoneyCompact(over60)} more than 60 days past due` : "") +
      (inv.medianDaysToPay != null ? `; paid invoices took a median ${inv.medianDaysToPay.toFixed(0)} days` : "") +
      (inv.paymentsTotal ? `; only ${pct(inv.onlineShare, 0)} of ${fmtMoneyCompact(inv.paymentsTotal)} received was paid online` : "") +
      "."
  );
  w.footer(`Source: Zuper Invoices & Payments · invoices by invoice date, aging vs due date as of today · payments by payment date · ${synced(ctx)}`);
  const topMode = inv.paymentModes[0];
  w.notes = {
    purpose: "Getting paid: what's outstanding and how overdue, how fast invoices are paid, and how customers pay.",
    callouts: compact([
      `${fmtMoneyCompact(inv.outstanding)} of ${fmtMoneyCompact(inv.invoiced)} invoiced is still outstanding.`,
      over60 > 0 && `${fmtMoneyCompact(over60)} is more than 60 days past due — the collections priority.`,
      inv.medianDaysToPay != null && `Paid invoices took a median ${inv.medianDaysToPay.toFixed(0)} days from invoice date to payment.`,
      inv.paidOnTimeShare != null && `${pct(inv.paidOnTimeShare, 0)} of paid invoices with a due date were paid on time.`,
      inv.paymentsTotal > 0 && `${pct(inv.onlineShare, 0)} of ${fmtMoneyCompact(inv.paymentsTotal)} received was paid online${inv.onlineShare < 0.2 ? " — low; Zuper Pay payment links and card-on-file are the lever" : ""}.`,
      topMode && `Most-used payment method: ${topMode.name} (${fmtMoneyCompact(topMode.amount)}).`,
    ]),
    metrics: [
      { label: "Invoiced", value: `${fmtMoneyCompact(inv.invoiced)} · ${plural(inv.count, "invoice")}`, definition: `Invoices dated in the period, excluding ${fmtInt(inv.voided)} voided/canceled.`, source: "Zuper Invoices", evidence: "Observed activity" },
      { label: "Collected", value: fmtMoneyCompact(inv.collected), definition: INVOICE_COLLECTION_DEFINITION, source: "Zuper Invoices", evidence: "Observed activity" },
      { label: "Outstanding > 60 days past due", value: fmtMoneyCompact(over60), definition: "Unpaid balance on these invoices whose due date is more than 60 days before today.", source: "Zuper Invoices", evidence: "Current state" },
      { label: "Median days to get paid", value: inv.medianDaysToPay == null ? "—" : `${inv.medianDaysToPay.toFixed(0)} days`, definition: `Invoice date → paid date for ${plural(inv.paidSample, "paid invoice")}.`, source: "Zuper Invoices", evidence: "Observed activity" },
      { label: "Payments collected online", value: pct(inv.onlineShare, 0), definition: "Payments dated in the period with payment mode type ONLINE ÷ all payments in the period (by amount).", source: "Zuper Payments", evidence: "Observed activity" },
    ],
    caveats: [
      "Payments are counted by payment date, so they can include payments for invoices issued before the period.",
      "ONLINE payment mode is the closest proxy the API gives for Zuper Pay / digital collection.",
      "Collections are cash timing — not revenue or profit.",
      syncLine(ctx),
    ],
  };
  return w;
}

// ---- 9. Workflow executions -------------------------------------------------------------

function executionsSlide(ctx: DeckContext, e: ExecutionDeepDive): ShapeWriter {
  const w = new ShapeWriter();
  const window = e.available ? `${fmtDate(e.countedFrom)} – ${fmtDate(e.countedTo)}` : periodText(ctx.range);
  w.header("Workflow Executions", `Runs ${window}  ·  Zuper keeps execution history from ${fmtDate(e.retainedFrom)}`);
  if (!e.available) {
    const box = w.card(CONTENT_X, KPI_Y, CONTENT_W, 4480000, "EXECUTION DATA");
    w.empty(box, "Workflow execution counts haven't been synced for this period yet — run a sync to include them.");
    w.insight("Execution counts come from Workflow Builder's execution history and are refreshed on every sync.");
    w.footer(`Source: Zuper Workflow Builder execution history · ${synced(ctx)}`);
    w.notes = {
      purpose: "How the account's automations actually ran — run volume, failures and their causes.",
      callouts: ["Execution counts aren't in this deck yet: the last sync didn't include this report period's workflow runs."],
      caveats: [
        "Re-run Sync from Zuper with this report's dates, then download the deck again. Zuper only keeps about two months of run history, so sync soon after the period ends.",
        syncLine(ctx),
      ],
      editBeforePresenting: ["Delete this slide if you can't re-sync before the meeting."],
    };
    return w;
  }

  w.kpis(KPI_Y, [
    { value: fmtInt(e.total), label: "Total executions" },
    { value: fmtInt(e.completed), label: "Completed" },
    { value: fmtInt(e.failed), label: `Failed (${pct(e.failureRate)} of runs)`, alert: e.failed > 0 },
    { value: fmtInt(e.skipped), label: "Skipped (conditions not met)" },
    { value: e.medianMs == null ? "—" : `${(e.medianMs / 1000).toFixed(1)} s`, label: `Median run time${e.p90Ms != null ? ` (p90 ${(e.p90Ms / 1000).toFixed(1)} s)` : ""}` },
  ]);

  const flows = e.perWorkflow.filter((f) => f.total > 0).slice(0, 8);
  const a = w.card(left.x, left.y, left.cx, left.cy, "EXECUTIONS PER WORKFLOW, BY OUTCOME");
  if (flows.length) {
    w.chart(a.x, a.y, a.cx, a.cy, {
      kind: "stackedBar",
      categories: flows.map((f) => truncate(f.name, 26)),
      series: [
        { name: "Completed", values: flows.map((f) => f.completed), color: GOOD },
        { name: "Failed", values: flows.map((f) => f.failed), color: CRITICAL },
        { name: "Skipped", values: flows.map((f) => f.skipped), color: NEUTRAL },
      ],
      showValues: false,
    });
  } else w.empty(a, "No workflow runs in this window");

  const b = w.card(right.x, right.y, right.cx, right.cy, "EXECUTIONS PER WEEK — ALL VS FAILED");
  if (e.weekly.some((x) => x.total)) {
    w.chart(b.x, b.y, b.cx, b.cy, {
      kind: "line",
      categories: e.weekly.map((x) => fmtDate(new Date(x.weekStart)).replace(/, \d{4}$/, "")),
      series: [
        { name: "All executions", values: e.weekly.map((x) => x.total), color: SERIES[1] },
        { name: "Failed", values: e.weekly.map((x) => x.failed), color: CRITICAL },
      ],
      showValues: false,
    });
  } else w.empty(b, "No runs in this window");

  const worst = [...e.perWorkflow].filter((f) => f.failed > 0).sort((x, y) => y.failed - x.failed)[0];
  const topError = e.topErrors[0];
  w.insight(
    [
      e.peakWeek && e.total ? `the busiest week (from ${fmtDate(new Date(e.peakWeek.weekStart))}) had ${fmtInt(e.peakWeek.total)} runs — ${pct(e.peakWeek.total / e.total, 0)} of the window` : null,
      worst ? `"${worst.name}" failed ${fmtInt(worst.failed)} times (${pct(worst.failureRate, 0)} of its runs)` : "no workflow runs failed",
      topError ? `most common failure: "${topError.message}" (${fmtInt(topError.count)} of ${fmtInt(e.errorSampleSize)} failed runs sampled)` : null,
    ]
      .filter(Boolean)
      .join("; ")
      .replace(/^./, (c) => c.toUpperCase()) + "."
  );
  w.footer(`Source: Zuper Workflow Builder execution history (exact counts) · failure rate excludes skipped runs · run time from ${fmtInt(Math.min(e.completed, 1000))} completed runs · ${synced(ctx)}`);
  w.notes = {
    purpose: "How the automations actually ran: volume, failures, and what's causing them.",
    callouts: compact([
      `${fmtInt(e.total)} runs in the window; ${pct(e.failureRate)} of runs that executed failed.`,
      worst && `"${worst.name}" failed ${fmtInt(worst.failed)} times (${pct(worst.failureRate, 0)} of its runs) — fix this one first.`,
      topError && `Most common failure: "${topError.message}" (${fmtInt(topError.count)} of ${fmtInt(e.errorSampleSize)} failed runs sampled).`,
      topError && /limit/i.test(topError.message) && "The account is hitting a Workflow Builder execution limit — review the plan limit or reduce unnecessary triggers (e.g. a workflow firing on every update).",
      e.peakWeek && e.total && e.peakWeek.total / e.total > 0.4 && `One week (from ${fmtDate(new Date(e.peakWeek.weekStart))}) had ${pct(e.peakWeek.total / e.total, 0)} of all runs — check for a runaway trigger.`,
    ]),
    metrics: [
      { label: "Total executions", value: fmtInt(e.total), definition: "Completed + failed + skipped runs in the window.", source: "Workflow Builder execution history", evidence: "Observed activity" },
      { label: "Failed", value: `${fmtInt(e.failed)} (${pct(e.failureRate)})`, definition: "Failed ÷ (completed + failed); skipped runs are excluded because their trigger conditions weren't met.", source: "Workflow Builder execution history", evidence: "Observed activity" },
      { label: "Skipped", value: fmtInt(e.skipped), definition: "Runs whose trigger fired but conditions weren't met.", source: "Workflow Builder execution history", evidence: "Observed activity" },
      { label: "Median run time", value: e.medianMs == null ? "—" : `${(e.medianMs / 1000).toFixed(1)} s`, definition: "Median execution_time_ms across up to 1,000 completed runs.", source: "Workflow Builder execution history", evidence: "Observed activity" },
    ],
    caveats: [
      `Zuper keeps about two months of run history (oldest available: ${fmtDate(e.retainedFrom)}), so the window can be shorter than the report period.`,
      "Run counts include retries — a high count isn't the same as more work automated.",
      syncLine(ctx),
    ],
  };
  return w;
}

// ---- Assembly -------------------------------------------------------------------------------

export interface ModuleDeckInput {
  customerId: string;
  customerName: string;
  range: DateRange;
  usage: LineItemUsage;
  workflowSummary: WorkflowSummary;
  /** Path of the generated automation slide, so executions can follow it. */
  automationSlidePath: string;
}

/** Computes every module's metrics and splices the deep-dive slides into their template sections. */
export async function insertModuleSlides(zip: JSZip, input: ModuleDeckInput): Promise<void> {
  const { customerId, range } = input;
  const [sync, jobs, accounts, team, projects, quotes, invoices, exec] = await Promise.all([
    computeSyncInfo(customerId, range),
    computeJobDeepDive(customerId, range),
    computeAccountsDeepDive(customerId, range),
    computeWorkforceDeepDive(customerId, range),
    computeProjectsDeepDive(customerId, range),
    computeQuoteDeepDive(customerId, range),
    computeInvoiceDeepDive(customerId, range),
    computeExecutionDeepDive(customerId, range),
  ]);
  const [delivery, portalPay, catalog, coverage] = await Promise.all([
    computeJobServiceDelivery(customerId, range),
    computePortalAndPay(customerId, range),
    computeCatalogAnalyses(customerId, range),
    computeCoverage(customerId),
  ]);
  const ctx: DeckContext = { customerName: input.customerName, range, sync };
  const cctx = { customerName: input.customerName, range, syncLine: syncLine(ctx) };

  // Template anchors: 12 = "Business KPI - Highlights" divider, 14 = Job Performance,
  // 15 = Daily Operations, 17 = Quote quarterly, 18 = Invoice quarterly.
  await insertGeneratedSlide(zip, "ppt/slides/slide12.xml", scopeSlide(ctx, scopeRows(jobs, input.usage, accounts, team, projects, quotes, invoices, input.workflowSummary, exec)));
  const volume = await insertGeneratedSlide(zip, "ppt/slides/slide14.xml", jobsVolumeSlide(ctx, jobs));
  const lifecycle = await insertGeneratedSlide(zip, volume, jobsLifecycleSlide(ctx, jobs));
  await insertChain(zip, lifecycle, [jobServiceSlide(cctx, delivery), timeOnSiteSlide(cctx, delivery)]);
  let after = await insertGeneratedSlide(zip, "ppt/slides/slide15.xml", accountsSlide(ctx, accounts));
  after = await insertGeneratedSlide(zip, after, workforceSlide(ctx, team, jobs.created));
  if (projects.total > 0) await insertGeneratedSlide(zip, after, projectsSlide(ctx, projects));
  await insertGeneratedSlide(zip, "ppt/slides/slide17.xml", quotesSlide(ctx, quotes));
  const invoiceDeepDive = await insertGeneratedSlide(zip, "ppt/slides/slide18.xml", invoicesSlide(ctx, invoices));
  await insertGeneratedSlide(zip, invoiceDeepDive, portalPaySlide(cctx, portalPay));

  // Adoption section: executions, Zuper Connect, then every other module with data, then coverage.
  const executions = await insertGeneratedSlide(zip, input.automationSlidePath, executionsSlide(ctx, exec));
  const byKey = new Map(catalog.map((m) => [m.key, m]));
  const SHOWN_ELSEWHERE = new Set(["job_timelogs", "unscheduled_jobs", "organizations_portal", "connect_calls", "connect_sms", "payment_requests"]);
  await insertChain(zip, executions, [
    connectSlide(cctx, byKey.get("connect_calls"), byKey.get("connect_sms"), coverage),
    ...catalog.filter((m) => !SHOWN_ELSEWHERE.has(m.key)).map((m) => moduleSlide(cctx, m)),
    ...coverageSlides(cctx, coverage),
  ]);
}
