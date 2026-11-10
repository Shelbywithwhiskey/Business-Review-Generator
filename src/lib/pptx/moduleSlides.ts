import type JSZip from "jszip";
import type { DateRange } from "@/lib/zuper/modules";
import type { LineItemUsage } from "@/lib/analytics";
import type { WorkflowSummary } from "@/lib/reports/ebrMetrics";
import {
  computeAccountsDeepDive,
  computeInvoiceDeepDive,
  computeProjectsDeepDive,
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
import { COLORS, CONTENT_W, CONTENT_X, ShapeWriter, collectCallouts, collectedCallouts, fmtInt, fmtMoneyCompact, insertGeneratedSlide, isPositive, run, truncate } from "./generatedSlide";
import { syncCaveat } from "./templateNotes";
import { computeCoverage, computePortalAndPay } from "@/lib/reports/catalogMetrics";
import { SETUP_MODULES, connectSlide, coverageSlides, insertChain, jobServiceSlide, moduleSlide, portalPaySlide, setupSlide, timeOnSiteSlide } from "./catalogSlides";
import { INVOICE_COLLECTION_DEFINITION, QUOTE_ACCEPTANCE_DEFINITION } from "@/lib/reports/classify";
import { momentum, topAcross, type Callout } from "@/lib/reports/callouts";
import type { SharedDeckData } from "./ebrTokens";
import { detectIndustry, type IndustryResult, type MetricKey } from "@/lib/reports/industry";
import type { CallSummary, CoverageRow } from "@/lib/reports/catalogMetrics";
import { generateStoryNarrative } from "@/lib/ai";
import { computeCustomerRevenue, computeSpeedEfficiency, computeTeamProductivity } from "@/lib/reports/insights";
import { builtTogetherSlide, customersRevenueSlide, scalingSlide, speedSlide, teamProductivitySlide, type Capability, type GrowthYear } from "./insightSlides";
import { METRIC_TITLES, flowSlide, growthSlide, industrySlide, journeySlide, thenNowSlide, yearOverYearSlide, type MetricReading } from "./storySlides";

const compact = (xs: (string | number | null | false | undefined)[]) => xs.filter((x): x is string => typeof x === "string" && x.length > 0);
type MaybeCallout = Callout | null | undefined | false | 0 | "";
const co = (xs: MaybeCallout[]): Callout[] => xs.filter((x): x is Callout => !!x && typeof x === "object");
const pct0 = (n: number) => `${(n * 100).toFixed(0)}%`;

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
const BODY_H = 3480000;
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
  if (hours < 0.1) return "At creation";
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
    { value: fmtInt(j.created), label: "Jobs created", spark: j.monthly.map((m) => m.created) },
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
  const trend = momentum(j.monthly.map((m) => ({ label: m.label, value: m.created })), 3, 30);
  const catRates = j.categories.filter((c) => c.created >= 10 && !c.name.startsWith("Other"));
  const best = [...catRates].sort((a, b) => b.completed / b.created - a.completed / a.created)[0];
  const worst = [...catRates].sort((a, b) => a.completed / a.created - b.completed / b.created)[0];
  w.keyCallouts(
    co([
      trend?.change != null &&
        Math.abs(trend.change) >= 0.1 && {
          tone: trend.change > 0 ? "win" : "risk",
          headline: `Job volume ${trend.change > 0 ? "up" : "down"} ${pct0(Math.abs(trend.change))} — ${fmtInt(trend.recent)} jobs in ${trend.recentLabel}`,
          detail: `vs ${fmtInt(trend.prior)} in ${trend.priorLabel}${trend.change > 0 ? "; more of the business is running through Zuper" : "; ask what changed in demand or intake"}.`,
          score: 58 + Math.min(20, Math.abs(trend.change) * 30),
          area: "Jobs",
        },
      best &&
        worst &&
        best !== worst && {
          tone: "watch",
          headline: `${best.name} completes ${pct0(best.completed / best.created)} of jobs; ${worst.name} ${pct0(worst.completed / worst.created)}`,
          detail: `categories run on different clocks — judge completion per category, not the ${pct0(j.completionRate)} overall.`,
          action: `Set a target completion time per category and review open ${worst.name} jobs weekly.`,
          score: 48,
          area: "Jobs",
        },
      j.unscheduledOpen > 0 &&
        j.created > 0 && {
          tone: j.unscheduledOpen / j.created > 0.25 ? "risk" : "watch",
          headline: `${fmtInt(j.unscheduledOpen)} open jobs have no schedule (${pct0(j.unscheduledOpen / j.created)} of the period's jobs)`,
          detail: `${plural(j.unscheduledOpen, "job")} on nobody's calendar, so they don't show on the dispatch board.`,
          action: "Date or close these in a weekly backlog review, and add a workflow that flags any job left unscheduled for 2+ days.",
          score: j.unscheduledOpen / j.created > 0.25 ? 62 : 40,
          area: "Jobs",
        },
      top &&
        j.created > 0 &&
        top.created / j.created > 0.6 && {
          tone: "watch",
          headline: `${top.name} is ${pct0(top.created / j.created)} of all jobs (${fmtInt(top.created)})`,
          detail: "one category carries most of the volume — confirm other work is categorized correctly.",
          score: 35,
          area: "Jobs",
        },
    ]),
    j.created
      ? `${pct(j.completionRate)} of the ${fmtInt(j.created)} jobs created this period are completed` + (busiest?.created ? `; busiest month was ${busiest.label} (${fmtInt(busiest.created)}).` : ".")
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

  const inDays = j.timeInStatus.some((t) => t.avgHours >= 48);
  const b = w.card(right.x, right.y, right.cx, right.cy, inDays ? "AVERAGE DAYS SPENT IN EACH STATUS" : "AVERAGE HOURS SPENT IN EACH STATUS");
  if (j.timeInStatus.length) {
    w.chart(b.x, b.y, b.cx, b.cy, {
      kind: "bar",
      categories: j.timeInStatus.map((t) => truncate(t.name, 28)),
      series: [{ name: inDays ? "Avg days in status" : "Avg hours in status", values: j.timeInStatus.map((t) => Math.round((inDays ? t.avgHours / 24 : t.avgHours) * 10) / 10), color: SERIES[1] }],
      numberFormat: "#,##0.0",
    });
  } else w.empty(b, "Not enough status history yet");

  const slowest = j.timeInStatus[0];
  const biggestOpen = j.openByStatus[0];
  const load = j.statusLoad[0];
  const loadShare = load ? load.jobDays / Math.max(j.statusLoad.reduce((s, x) => s + x.jobDays, 0), 1) : 0;
  w.keyCallouts(
    co([
      biggestOpen &&
        biggestOpen.count >= 10 && {
          tone: (biggestOpen.medianAgeDays ?? 0) > 30 ? "risk" : "watch",
          headline: `${fmtInt(biggestOpen.count)} open jobs sit in "${biggestOpen.name}" — median age ${biggestOpen.medianAgeDays?.toFixed(0) ?? "—"} days`,
          detail: `the largest pile of unfinished work${j.openByStatus[1] ? `, ahead of "${j.openByStatus[1].name}" (${fmtInt(j.openByStatus[1].count)})` : ""}.`,
          action: `Review every "${biggestOpen.name}" job older than 30 days, and add a workflow alert when a job sits in this status too long.`,
          score: (biggestOpen.medianAgeDays ?? 0) > 30 ? 70 : 45,
          area: "Jobs",
        },
      load &&
        load.jobs >= 10 && {
          tone: "watch",
          headline: `"${load.name}" absorbs ${pct0(loadShare)} of all time jobs spend in a status`,
          detail: `${fmtInt(load.jobs)} jobs × ${load.avgDays.toFixed(1)} days on average — the single biggest lever on cycle time.`,
          action: `Find out what jobs wait for in "${load.name}" (parts, approval, paperwork) and automate the hand-off out of it.`,
          score: 55,
          area: "Jobs",
        },
      j.medianHoursToSchedule != null &&
        j.medianHoursToSchedule < 1 && {
          tone: "win",
          headline: "Jobs are scheduled as soon as they're created",
          detail: `median time from creation to schedule is ${fmtDuration(j.medianHoursToSchedule).toLowerCase()} — no scheduling backlog.`,
          score: 30,
          area: "Jobs",
        },
      // (The plain "median job takes N days" line was dropped: it fired on every deck and said nothing
      // actionable — cycle time vs the previous period is on the Speed & Efficiency page.)
    ]),
    "Not enough status history to show where jobs slow down."
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

  // A property ranking where every property has 1–2 jobs says nothing — show customer growth instead.
  const propsMeaningful = a.topPropertiesByJobs.length > 0 && a.topPropertiesByJobs[0].jobs >= 3;
  const showGrowth = !propsMeaningful && a.customersMonthly.some((m) => m.count > 0);
  const propCard = w.card(right.x, right.y, right.cx, right.cy, propsMeaningful ? "MOST-SERVICED PROPERTIES (ALL-TIME JOBS)" : showGrowth ? "NEW CUSTOMERS PER MONTH" : "CUSTOMERS BY CATEGORY");
  if (showGrowth) {
    w.chart(propCard.x, propCard.y, propCard.cx, propCard.cy, {
      kind: "column",
      categories: a.customersMonthly.map((m) => m.label),
      series: [{ name: "New customers", values: a.customersMonthly.map((m) => m.count), color: SERIES[1] }],
    });
  } else if (propsMeaningful) {
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
  const custTrend = momentum(a.customersMonthly.map((m) => ({ label: m.label, value: m.count })), 3, 20);
  w.keyCallouts(
    co([
      a.customers.newInPeriod > 0 && {
        tone: "win",
        headline: `${fmtInt(a.customers.newInPeriod)} new customers added this period`,
        detail: `${pct0(a.customers.newInPeriod / Math.max(a.customers.total, 1))} of the ${fmtInt(a.customers.total)}-customer base${custTrend?.change != null ? `; ${custTrend.change >= 0 ? "up" : "down"} ${pct0(Math.abs(custTrend.change))} in ${custTrend.recentLabel}` : ""}.`,
        score: 50,
        area: "Customers",
      },
      a.customers.total >= 50 &&
        a.customers.repeatShare < 0.2 && {
          tone: "opportunity",
          headline: `Only ${pct0(a.customers.repeatShare)} of customers have booked more than one job`,
          detail: `${fmtInt(Math.round(a.customers.total * (1 - a.customers.repeatShare)))} of ${fmtInt(a.customers.total)} customers have only ever booked one job.`,
          action: "Offer maintenance plans or service contracts to one-time customers, starting with the highest-value ones.",
          score: 60,
          area: "Customers",
        },
      a.top5LtvShare > 0.5 && {
        tone: "risk",
        headline: `Top 5 customers hold ${pct0(a.top5LtvShare)} of lifetime value`,
        detail: `led by ${a.topCustomersByLtv.slice(0, 2).map((c) => `${c.name} (${fmtMoneyCompact(c.ltv)})`).join(" and ")} — losing one would be felt.`,
        action: "Put the top accounts on service agreements with a named contact, and track their activity every month.",
        score: 58,
        area: "Customers",
      },
      topOrg &&
        a.jobsWithOrganization > 0 && {
          tone: "watch",
          headline: `${topOrg.name} drove ${pct0(topOrg.jobs / a.jobsWithOrganization)} of organization jobs`,
          detail: `${fmtInt(topOrg.jobs)} jobs this period — the most important B2B relationship.`,
          score: 45,
          area: "Customers",
        },
      a.totalReceivables > 0 && {
        tone: "watch",
        headline: `${fmtMoneyCompact(a.totalReceivables)} in customer receivables (all-time)`,
        detail: "Zuper's own ledger figure across every customer — who owes the most is on the Customers & Revenue page.",
        score: 30,
        area: "Customers",
      },
    ]),
    `${fmtInt(a.customers.total)} customers on the account.`
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

function workforceSlide(ctx: DeckContext, t: WorkforceDeepDive, jobsCreated: number, jobTimelogs: { entries: number; hours: number; people: number } | null = null): ShapeWriter {
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
    ? `${plural(t.timesheetEvents, "clock-in/out event")} recorded, totalling ${fmtInt(t.timesheetHours)} hours on the clock in this period.` +
      (jobTimelogs ? ` Plus ${plural(jobTimelogs.entries, "job time log")} (${fmtInt(jobTimelogs.hours)} h).` : "")
    : jobTimelogs
      ? `No shift clock-ins (timesheets) this period. ${plural(jobTimelogs.entries, "job time log")} were recorded (${fmtInt(jobTimelogs.hours)} h, ${fmtInt(jobTimelogs.people)} ${jobTimelogs.people === 1 ? "person" : "people"}) — see the Time Logged slide. Consistent clock-in unlocks utilization and labor-cost-per-job reporting.`
      : "No timesheet clock-ins or job time logs were recorded in this period. Turning on clock-in/out and job time logging unlocks utilization, overtime and labor-cost-per-job reporting.";
  w.text(b.x + 60000, b.y + 100000, b.cx - 120000, b.cy - 200000, run(message, { sz: 1100, color: COLORS.ink }));

  const byAssigned = [...t.byTechnician].sort((x, y) => y.assigned - x.assigned);
  const top = byAssigned[0];
  const topShare = top && t.jobsAssigned ? top.assigned / t.jobsAssigned : 0;
  const top3Share = t.jobsAssigned ? byAssigned.slice(0, 3).reduce((s, p) => s + p.assigned, 0) / t.jobsAssigned : 0;
  const rated = byAssigned.filter((p) => p.assigned >= 20);
  const fastest = [...rated].sort((x, y) => y.completed / y.assigned - x.completed / x.assigned)[0];
  const slowestTech = [...rated].sort((x, y) => x.completed / x.assigned - y.completed / y.assigned)[0];
  w.keyCallouts(
    co([
      top3Share > 0.6 &&
        byAssigned.length > 3 && {
          tone: "risk",
          headline: `3 people carry ${pct0(top3Share)} of all assigned jobs`,
          detail: `${byAssigned.slice(0, 3).map((p) => p.name).join(", ")} — a key-person dependency if one is out.`,
          score: 60,
          area: "Team",
        },
      fastest &&
        slowestTech &&
        fastest !== slowestTech &&
        fastest.completed / fastest.assigned - slowestTech.completed / slowestTech.assigned >= 0.2 && {
          tone: "watch",
          headline: `Completion ranges from ${pct0(slowestTech.completed / slowestTech.assigned)} (${slowestTech.name}) to ${pct0(fastest.completed / fastest.assigned)} (${fastest.name})`,
          detail: `among ${plural(rated.length, "person")} with 20+ assigned jobs this period.`,
          action: `Compare ${slowestTech.name}'s job mix and open jobs with ${fastest.name}'s, and rebalance or coach where the gap isn't explained by job type.`,
          score: 50,
          area: "Team",
        },
      t.jobsUnassigned > 0 &&
        jobsCreated > 0 && {
          tone: t.jobsUnassigned / jobsCreated > 0.2 ? "risk" : "watch",
          headline: `${fmtInt(t.jobsUnassigned)} jobs have no one assigned (${pct0(t.jobsUnassigned / jobsCreated)})`,
          detail: `these ${plural(t.jobsUnassigned, "job")} don't reach anyone's mobile app.`,
          action: "Assign or close them, and add a workflow that alerts dispatch when a job still has no technician the day before it's due.",
          score: t.jobsUnassigned / jobsCreated > 0.2 ? 58 : 38,
          area: "Team",
        },
      !t.timesheetEvents &&
        !jobTimelogs && {
        tone: "opportunity",
        headline: "Time tracking isn't in use",
        detail: `${plural(jobsCreated, "job")} this period with no clock-in data, so labor cost per job can't be measured.`,
        action: "Switch on clock-in/out in the Zuper mobile app for the field team, starting with one crew.",
        score: 35,
        area: "Team",
      },
      top &&
        !(top3Share > 0.6 && byAssigned.length > 3) && {
          tone: "watch",
          headline: `${top.name} carried the most work — ${fmtInt(top.assigned)} jobs (${pct0(topShare)})`,
          detail: `${fmtInt(top.completed)} of them completed.`,
          score: 30,
          area: "Team",
        },
    ]),
    `${plural(t.teamSize, "active user")} on the account.`
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
  w.keyCallouts(
    co([
      p.createdInPeriod > 0 && {
        tone: "win",
        headline: `${fmtInt(p.createdInPeriod)} projects created this period`,
        detail: `${fmtInt(p.total)} on the account — multi-job work is being managed as projects in Zuper.`,
        score: 40,
        area: "Projects",
      },
      p.byStatus[0] &&
        p.createdInPeriod > 0 && {
          tone: "watch",
          headline: `${pct0(p.byStatus[0].count / p.createdInPeriod)} of new projects are in "${p.byStatus[0].name}"`,
          detail: `${fmtInt(p.byStatus[0].count)} projects — check they're moving to the next stage.`,
          score: 38,
          area: "Projects",
        },
    ]),
    `${plural(p.total, "project")} on the account; none were created this period.`
  );
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
    { value: fmtInt(q.count), label: `Quotes created (${fmtMoneyCompact(q.value)})`, spark: q.monthly.map((m) => m.created) },
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
  const qTrend = momentum(q.monthly.map((m) => ({ label: m.label, value: m.created })), 3, 30);
  w.keyCallouts(
    co([
      q.staleOpen.count >= 5 && {
        tone: "opportunity",
        headline: `${fmtInt(q.staleOpen.count)} quotes worth ${fmtMoneyCompact(q.staleOpen.value)} have waited 30+ days for a decision`,
        detail: `${fmtMoneyCompact(q.staleOpen.value)} of potential work with no answer — some of it still closes with a nudge.`,
        action: "Call the largest open quotes this week, and switch on automated quote follow-ups at day 3, 7 and 14.",
        score: 74,
        area: "Quotes",
      },
      q.sent > 0 &&
        q.expiredOpen / q.sent >= 0.15 && {
          tone: "risk",
          headline: `${fmtInt(q.expiredOpen)} quotes expired without approval (${pct0(q.expiredOpen / q.sent)} of sent)`,
          detail: `${pct0(q.expiredOpen / q.sent)} of quotes sent this period ran out without a decision.`,
          action: "Send a reminder 3 days before a quote expires, and re-issue expired quotes that are still relevant.",
          score: 64,
          area: "Quotes",
        },
      q.medianDaysToAccept != null &&
        q.medianDaysToAccept <= 3 &&
        q.acceptSample >= 10 && {
          tone: "win",
          headline: `Accepted quotes close fast — median ${q.medianDaysToAccept.toFixed(1)} days`,
          detail: "customers who say yes decide quickly, so a quote still open after a week needs a nudge.",
          score: 45,
          area: "Quotes",
        },
      qTrend?.change != null &&
        Math.abs(qTrend.change) >= 0.15 && {
          tone: qTrend.change > 0 ? "win" : "risk",
          headline: `Quote volume ${qTrend.change > 0 ? "up" : "down"} ${pct0(Math.abs(qTrend.change))} — ${fmtInt(qTrend.recent)} in ${qTrend.recentLabel}`,
          detail: `vs ${fmtInt(qTrend.prior)} in ${qTrend.priorLabel}.`,
          score: 50,
          area: "Quotes",
        },
      q.sent > 0 && {
        tone: q.conversionRate < 0.3 ? "risk" : q.conversionRate >= 0.5 ? "win" : "watch",
        headline: `${pct(q.conversionRate)} of ${plural(q.sent, "sent quote")} accepted (${fmtMoneyCompact(q.convertedValue)})`,
        detail: topStatus ? `most quotes sit in "${topStatus.name.replace(/_/g, " ").toLowerCase()}" (${fmtInt(topStatus.count)}).` : "",
        action: q.conversionRate < 0.3 ? "Offer Good-Better-Best options on quotes and follow up within 48 hours of sending." : undefined,
        score: q.conversionRate < 0.3 ? 60 : 44,
        area: "Quotes",
      },
    ]),
    "No quotes were created in this period — quoting in Zuper would make pipeline and win-rate visible here."
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

  const pastDue = inv.aging.filter((b) => b.label !== "Not yet due");
  const biggestBucket = [...pastDue].sort((x, y) => y.amount - x.amount)[0];
  const checkMode = inv.paymentModes.find((m) => /check|cheque/i.test(m.name));
  const checkShare = checkMode && inv.paymentsTotal ? checkMode.amount / inv.paymentsTotal : 0;
  w.keyCallouts(
    co([
      over60 > 0 && {
        tone: "risk",
        headline: `${fmtMoneyCompact(over60)} is 60+ days past due`,
        detail: `part of ${fmtMoneyCompact(inv.outstanding)} still outstanding on this period's invoices — the collections priority.`,
        action: "Work the 60+ day list first: send statements with a Zuper Pay link, then phone the largest balances.",
        score: over60 > 50_000 ? 72 : 55,
        area: "Collections",
      },
      biggestBucket &&
        biggestBucket.amount > 0 &&
        biggestBucket.label !== "90+ days" && {
          tone: "watch",
          headline: `Most overdue money is ${biggestBucket.label} past due (${fmtMoneyCompact(biggestBucket.amount)})`,
          detail: `${fmtMoneyCompact(biggestBucket.amount)} is still recent enough to collect easily if someone chases it now.`,
          action: "Turn on automatic payment reminders at 7 and 14 days past due, each with a pay-now link.",
          score: 52,
          area: "Collections",
        },
      checkShare >= 0.4 && {
        tone: "opportunity",
        headline: `Checks are ${pct0(checkShare)} of payments (${fmtMoneyCompact(checkMode!.amount)})`,
        detail: `${fmtMoneyCompact(checkMode!.amount)} arrived by check — slower to arrive and keyed in by hand.`,
        action: "Send every invoice with a Zuper Pay link (card or ACH) and offer card-on-file to repeat customers.",
        score: 62,
        area: "Collections",
      },
      checkShare < 0.4 &&
        inv.paymentsTotal > 0 &&
        inv.onlineShare < 0.2 && {
          tone: "opportunity",
          headline: `Only ${pct0(inv.onlineShare)} of ${fmtMoneyCompact(inv.paymentsTotal)} received was paid online`,
          detail: `${fmtMoneyCompact(inv.paymentsTotal * (1 - inv.onlineShare))} was paid offline (cash, check or manual entry).`,
          action: "Send every invoice with a Zuper Pay link (card or ACH) and offer card-on-file to repeat customers.",
          score: 58,
          area: "Collections",
        },
      inv.medianDaysToPay != null &&
        inv.paidSample >= 10 && {
          tone: inv.medianDaysToPay <= 15 ? "win" : "watch",
          headline: `Paid invoices were paid in a median ${inv.medianDaysToPay.toFixed(0)} days`,
          detail: inv.paidOnTimeShare != null ? `${pct0(inv.paidOnTimeShare)} of them by their due date.` : "",
          action: inv.medianDaysToPay > 30 ? "Add a pay-now link to every invoice and turn on automatic reminders before and after the due date." : undefined,
          score: inv.medianDaysToPay <= 15 ? 42 : 48,
          area: "Collections",
        },
    ]),
    `${fmtMoneyCompact(inv.outstanding)} of ${fmtMoneyCompact(inv.invoiced)} invoiced is still outstanding.`
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
    { value: fmtInt(e.failed), label: `Failed (${pct(e.failureRate, 0)} of runs that executed)`, alert: e.failed > 0 },
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
  const skippedShare = e.total ? e.skipped / e.total : 0;
  w.keyCallouts(
    co([
      worst &&
        e.failed >= 10 && {
          tone: "risk",
          headline: `"${truncate(worst.name, 40)}" causes ${pct0(worst.failed / e.failed)} of ${fmtInt(e.failed)} failed runs`,
          detail: `it fails ${pct0(worst.failureRate)} of the time — fixing this one workflow removes most failures.`,
          score: 76,
          area: "Automation",
        },
      topError &&
        e.errorSampleSize > 0 && {
          tone: "risk",
          headline: `Most common error: "${truncate(topError.message, 50)}"`,
          detail: `${fmtInt(topError.count)} of ${fmtInt(e.errorSampleSize)} sampled failures${/permission|allowed|access/i.test(topError.message) ? " — a permissions issue on the workflow's user, usually a quick fix" : /limit/i.test(topError.message) ? " — the account is hitting an execution limit" : ""}.`,
          score: 60,
          area: "Automation",
        },
      e.failed === 0 &&
        e.completed > 0 && {
          tone: "win",
          headline: `${fmtInt(e.completed)} workflow runs, none failed`,
          detail: "automations are running cleanly.",
          score: 50,
          area: "Automation",
        },
      skippedShare >= 0.5 && {
        tone: "watch",
        headline: `${pct0(skippedShare)} of runs were skipped (${fmtInt(e.skipped)})`,
        detail: "triggers fire far more often than conditions match — tightening trigger filters cuts noise and execution usage.",
        score: 44,
        area: "Automation",
      },
    ]),
    e.total ? `${fmtInt(e.total)} workflow runs in the window.` : "No workflow runs in this window."
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
  shared: SharedDeckData;
  /** e.g. "Quarterly Business Review" — used in slide wording. */
  reviewName: string;
}

// ---- Top call-outs (executive summary) ---------------------------------------------------------

const TONE_FILL: Record<Callout["tone"], string> = { win: "E7F6E7", risk: "FBE9E7", opportunity: "FFF0E6", watch: "F1F1F1" };
const TONE_INK: Record<Callout["tone"], string> = { win: "0B7A0B", risk: "B5271C", opportunity: "C03D00", watch: "4B5563" };
const TONE_WORD: Record<Callout["tone"], string> = { win: "WIN", risk: "RISK", opportunity: "OPPORTUNITY", watch: "WATCH" };

function topCalloutsSlide(ctx: DeckContext, all: Callout[]): ShapeWriter {
  // Wins and opportunities only — risks and watch items are on the closing reference slide.
  const top = topAcross(all.filter(isPositive), 6, 2);
  const w = new ShapeWriter();
  w.header(`Highlights — ${truncate(ctx.customerName, 40)}`, `What's working and where to grow next, ${periodText(ctx.range)}  ·  details on the slides that follow`);
  const cols = 2;
  const gap = 150000;
  const cw = (CONTENT_W - gap) / cols;
  const y0 = 1300000;
  const ch = 1420000;
  top.slice(0, 6).forEach((c, i) => {
    const x = CONTENT_X + (i % cols) * (cw + gap);
    const y = y0 + Math.floor(i / cols) * (ch + 120000);
    w.rect(x, y, cw, ch, COLORS.white, { radius: 6000, border: COLORS.border });
    w.rect(x + 160000, y + 150000, 1350000, 260000, TONE_FILL[c.tone], { radius: 50000 });
    w.text(x + 160000, y + 150000, 1350000, 260000, run(TONE_WORD[c.tone], { sz: 800, color: TONE_INK[c.tone], bold: true }), { algn: "ctr", anchor: "ctr", wrap: "none" });
    w.text(x + 1600000, y + 150000, cw - 1760000, 260000, run(c.area.toUpperCase(), { sz: 800, color: COLORS.faint, bold: true }), { anchor: "ctr", wrap: "none" });
    w.text(x + 160000, y + 500000, cw - 320000, 420000, run(c.headline, { sz: 1250, color: COLORS.ink, bold: true }));
    w.text(x + 160000, y + 930000, cw - 320000, 440000, run(c.detail.replace(/^./, (s) => s.toUpperCase()), { sz: 950, color: COLORS.muted }));
  });
  if (!top.length) w.empty({ x: CONTENT_X, y: y0, cx: CONTENT_W, cy: 4400000 }, "Not enough synced data to rank findings — run Sync from Zuper first.");
  w.footer("Ranked by materiality across every slide in this deck · each finding is repeated, with its definition, on its own slide and in the speaker notes");
  w.notes = {
    purpose: "The executive summary: the handful of findings worth saying out loud, ranked across every area of the account.",
    callouts: top.map((c) => `${TONE_WORD[c.tone]} (${c.area}): ${c.headline} — ${c.detail}`),
    talkingPoints: [
      "Open with the wins, then the one or two risks that need a decision, then the opportunities you'll propose on the priorities slide.",
      "Every number here is on its own slide later — use those slides if the customer wants the detail.",
    ],
    caveats: ["Ranking is by a fixed materiality score (e.g. money at stake, share of work affected), not by AI.", syncLine(ctx)],
  };
  return w;
}

/** What the Account Brief needs from the module pass (see lib/reports/accountBrief.ts). */
export interface ModuleSlidesResult {
  /** The Top Call-outs slide, which the brief slide follows. */
  topCalloutsPath: string;
  /** "What We've Built Together", when the account has enough in use; the improvement page follows it. */
  builtTogetherPath: string | null;
  industry: IndustryResult;
  monthsOnZuper: number | null;
  coverage: CoverageRow[];
}

/** Computes every module's metrics and splices the deep-dive slides into their template sections. */
export async function insertModuleSlides(zip: JSZip, input: ModuleDeckInput): Promise<ModuleSlidesResult> {
  const { customerId, range, shared } = input;
  const { sync, jobsDeep: jobs, quotesDeep: quotes, exec, catalog, delivery } = shared;
  const [accounts, team, projects, invoices, portalPay, coverage, customerRevenue, productivity, speed] = await Promise.all([
    computeAccountsDeepDive(customerId, range),
    computeWorkforceDeepDive(customerId, range),
    computeProjectsDeepDive(customerId, range),
    computeInvoiceDeepDive(customerId, range),
    computePortalAndPay(customerId, range),
    computeCoverage(customerId),
    computeCustomerRevenue(customerId, range),
    computeTeamProductivity(customerId, range),
    computeSpeedEfficiency(customerId, range),
  ]);
  const ctx: DeckContext = { customerName: input.customerName, range, sync };
  const cctx = { customerName: input.customerName, range, syncLine: syncLine(ctx) };

  // Template anchors: 12 = "Business KPI - Highlights" divider, 14 = Job Performance,
  // 15 = Daily Operations, 17 = Quote quarterly, 18 = Invoice quarterly.
  const scope = await insertGeneratedSlide(zip, "ppt/slides/slide12.xml", scopeSlide(ctx, scopeRows(jobs, input.usage, accounts, team, projects, quotes, invoices, input.workflowSummary, exec)));
  // Deep-dive slides are only added for areas with records; an all-zero slide is left out of the deck.
  const tl = delivery.timeOnSite;
  await insertChain(zip, "ppt/slides/slide14.xml", [
    jobs.created > 0 ? jobsVolumeSlide(ctx, jobs) : null,
    jobs.created > 0 ? jobsLifecycleSlide(ctx, jobs) : null,
    delivery.jobsInPeriod > 0 ? jobServiceSlide(cctx, delivery) : null,
    timeOnSiteSlide(cctx, delivery),
    speedSlide(cctx, speed),
  ]);
  const hasAccounts = accounts.customers.total + accounts.organizations.total + accounts.properties.total > 0;
  const hasTeam = team.teamSize > 0 || team.jobsAssigned > 0 || team.timesheetEvents > 0;
  await insertChain(zip, "ppt/slides/slide15.xml", [
    hasAccounts ? accountsSlide(ctx, accounts) : null,
    customersRevenueSlide(cctx, customerRevenue),
    hasTeam ? workforceSlide(ctx, team, jobs.created, tl ? { entries: tl.entries, hours: tl.hours, people: tl.people.length } : null) : null,
    teamProductivitySlide(cctx, productivity),
    projects.total > 0 ? projectsSlide(ctx, projects) : null,
  ]);
  if (quotes.count > 0) await insertGeneratedSlide(zip, "ppt/slides/slide17.xml", quotesSlide(ctx, quotes));
  const hasPortalPay = !!portalPay.portalOrgs || !!portalPay.paymentRequests || portalPay.paymentSources.length > 0 || portalPay.online.total > 0;
  await insertChain(zip, "ppt/slides/slide18.xml", [
    invoices.count > 0 || invoices.paymentsTotal > 0 ? invoicesSlide(ctx, invoices) : null,
    hasPortalPay ? portalPaySlide(cctx, portalPay) : null,
  ]);

  // Adoption section: executions, Zuper Connect, then every other module with data, then coverage.
  const executions = await insertChain(zip, input.automationSlidePath, [exec.available && exec.total > 0 ? executionsSlide(ctx, exec) : null]);
  const byKey = new Map(catalog.map((m) => [m.key, m]));
  const SHOWN_ELSEWHERE = new Set(["job_timelogs", "unscheduled_jobs", "organizations_portal", "connect_calls", "connect_sms", "payment_requests"]);
  const quotesTotal = quotes.count;
  const jobsAllTime = jobs.created;
  const own = catalog.filter((m) => !SHOWN_ELSEWHERE.has(m.key) && !SETUP_MODULES.has(m.key));
  const setup = catalog.filter((m) => SETUP_MODULES.has(m.key));
  // No Connect data: the slide would be an empty box, so leave it out — its opportunity/watch
  // call-out still reaches the Account Brief and the reference slide.
  const connect = byKey.has("connect_calls") || byKey.has("connect_sms") ? connectSlide(cctx, byKey.get("connect_calls"), byKey.get("connect_sms"), coverage) : null;
  const connectHasData = !!byKey.get("connect_calls")?.calls;
  if (connect && !connectHasData) collectCallouts(zip, connect.callouts);
  await insertChain(zip, executions, [
    connectHasData ? connect : null,
    ...own.map((m) => moduleSlide(cctx, m, { quotesInPeriod: quotesTotal, jobsInPeriod: jobsAllTime })),
    setupSlide(cctx, setup),
    ...coverageSlides(cctx, coverage),
  ]);

  // ---- Story: industry lens, journey on Zuper, then vs now, growth; and the work/money flow ----------
  const industry = detectIndustry({
    website: shared.website,
    customerName: input.customerName,
    jobCategories: jobs.categories.filter((c) => !c.name.startsWith("Other")).map((c) => ({ name: c.name, count: c.created })),
    lineItemNames: input.usage.byType.flatMap((t) => t.usage.top.map((x) => x.name)),
  });
  const calls = byKey.get("connect_calls")?.calls;
  const readings = industryReadings({ jobs, quotes, invoices, accounts, delivery, exec, calls, workflowLive: input.workflowSummary.live });
  const matterFacts = Object.fromEntries(industry.whatMatters.map((m) => [METRIC_TITLES[m.metric], readings[m.metric] ? `${readings[m.metric]!.value} (${readings[m.metric]!.note})` : "not measured"]));
  const industryFallback =
    `${input.customerName} runs a ${industry.label.toLowerCase()} operation on Zuper. ` +
    industry.whatMatters
      .slice(0, 3)
      .map((m) => (readings[m.metric] ? `${METRIC_TITLES[m.metric]}: ${readings[m.metric]!.value}` : null))
      .filter(Boolean)
      .join("; ") +
    ".";
  const j = shared.journey;
  const better = j.metrics.filter((m) => m.improved);
  const journeyFacts = {
    onZuperSince: j.goLive?.toISOString().slice(0, 7),
    monthsOnZuper: j.monthsOnZuper,
    totals: { jobs: fmtInt(j.totals.jobs), invoiced: fmtMoneyCompact(j.totals.invoiced), collected: fmtMoneyCompact(j.totals.collected) },
    changes: j.metrics.map((m) => ({ metric: m.label, then: storyValue(m, m.early), now: storyValue(m, m.now), better: m.improved })),
  };
  const journeyFallback = j.goLive
    ? `On Zuper for ${j.monthsOnZuper} months, ${input.customerName} has run ${fmtInt(j.totals.jobs)} jobs${j.uses.invoices ? ` and invoiced ${fmtMoneyCompact(j.totals.invoiced)}` : ""} through the platform.` +
      (better[0] ? ` Since the early months, ${better[0].label.toLowerCase()} has gone from ${storyValue(better[0], better[0].early)} to ${storyValue(better[0], better[0].now)}.` : "")
    : "No activity recorded yet.";
  const [industryNarrative, journeyNarrative] = await Promise.all([
    generateStoryNarrative("industry", { customer: input.customerName, trade: industry.label, whatMattersAndTheirNumbers: matterFacts }, shared.website, industryFallback),
    generateStoryNarrative("journey", journeyFacts, shared.website, journeyFallback),
  ]);
  const yoySlide = yearOverYearSlide(cctx, shared.yoy, input.reviewName);
  await insertChain(zip, scope, [industrySlide(cctx, industry, readings, industryNarrative), journeySlide(cctx, j, journeyNarrative), thenNowSlide(cctx, j), yoySlide, growthSlide(cctx, j)]);
  // A year-over-year decline is a watch item: when the slide is skipped (nothing grew), its call-outs
  // still need to reach the brief and the reference slide.
  if (!yoySlide) collectCallouts(zip, shared.yoy.callouts);
  const inv = shared.quotesDeep;
  await insertGeneratedSlide(
    zip,
    "ppt/slides/slide13.xml",
    flowSlide(cctx, {
      jobsCreated: jobs.created,
      jobsScheduled: jobs.scheduled,
      jobsCompleted: jobs.completed,
      quotedValue: inv.value,
      quotesCount: inv.count,
      acceptedValue: inv.convertedValue,
      acceptedCount: inv.convertedCount,
      invoicedValue: invoices.invoiced,
      invoiceCount: invoices.count,
      collectedValue: invoices.collected,
      moneyInZuper: j.uses.quotes || j.uses.invoices,
    })
  );

  // ---- Partnership pages rebuilt from the account's data (template 26 and 29 carried sample copy) ----
  const proposalTemplates = byKey.get("proposal_templates")?.total ?? 0;
  const live = input.workflowSummary;
  const capabilities: Capability[] = [
    {
      title: "Job Management",
      points: compact([
        j.totals.jobs > 0 && `${fmtInt(j.totals.jobs)} jobs run through Zuper since ${j.goLive ? fmtDate(j.goLive) : "go-live"}`,
        jobs.categories.length > 1 && `${fmtInt(jobs.categories.length)} job categories in use, led by ${jobs.categories[0].name}`,
        jobs.created > 0 && `${pct0(jobs.completionRate)} of this period's ${fmtInt(jobs.created)} jobs completed`,
      ]),
    },
    {
      title: "Scheduling & Dispatch",
      points: compact([
        team.teamSize > 0 && `${fmtInt(team.teamSize)} active users working in Zuper`,
        jobs.created > 0 && team.jobsAssigned > 0 && `${pct0(team.jobsAssigned / jobs.created)} of jobs assigned to a technician`,
        jobs.medianHoursToSchedule != null && `Jobs scheduled a median ${fmtDuration(jobs.medianHoursToSchedule).toLowerCase()} after creation`,
      ]),
    },
    j.uses.quotes && {
      title: "Quotes & Proposals",
      points: compact([
        `${fmtMoneyCompact(j.totals.quoteValue)} quoted across ${fmtInt(j.totals.quotes)} quotes`,
        quotes.sent > 0 && `${pct0(quotes.conversionRate)} of quotes sent this period accepted`,
        proposalTemplates > 0 && `${plural(proposalTemplates, "proposal template")} for consistent, branded quotes`,
      ]),
    },
    j.uses.invoices && {
      title: "Invoicing & Payments",
      points: compact([
        `${fmtMoneyCompact(j.totals.invoiced)} invoiced and ${fmtMoneyCompact(j.totals.collected)} collected in Zuper`,
        invoices.paymentsTotal > 0 && `${pct0(invoices.onlineShare)} of this period's payments collected online`,
        invoices.medianDaysToPay != null && `Invoices paid a median ${invoices.medianDaysToPay.toFixed(0)} days after issue`,
      ]),
    },
    live.live > 0 && {
      title: "Workflow Automation",
      points: compact([
        `${plural(live.live, "live workflow")} automating ${plural(live.liveSteps, "step")}`,
        live.triggers[0] && `Most common trigger: ${live.triggers[0].name}`,
        exec.available && exec.total > 0 && `${fmtInt(exec.total)} automated runs in the review window`,
      ]),
    },
    calls &&
      calls.inPeriod > 0 && {
        title: "Zuper Connect",
        points: compact([
          `${fmtInt(calls.inPeriod)} calls handled through Zuper Connect this period`,
          calls.recordedShare != null && calls.recordedShare > 0 && `${pct0(calls.recordedShare)} of calls recorded on the job record`,
        ]),
      },
    accounts.customers.total > 0 && {
      title: "Customers & Properties",
      points: compact([
        `${fmtInt(accounts.customers.total)} customers managed in Zuper`,
        accounts.properties.total > 0 && `${fmtInt(accounts.properties.total)} service properties on record`,
        accounts.organizations.total > 0 && `${fmtInt(accounts.organizations.total)} B2B organizations`,
      ]),
    },
    portalPay.portalOrgs &&
      portalPay.portalOrgs.enabled > 0 && {
        title: "Customer Portal",
        points: compact([`Portal access on for ${fmtInt(portalPay.portalOrgs.enabled)} organizations`, portalPay.portalPayments && portalPay.portalPayments.count > 0 && `${plural(portalPay.portalPayments.count, "payment")} made through the portal`]),
      },
    projects.total > 0 && { title: "Projects", points: [`${plural(projects.total, "multi-job project")} managed in Zuper`] },
  ].filter((c): c is Capability => !!c && typeof c === "object" && c.points.length > 0);
  const built = builtTogetherSlide(cctx, capabilities, j.goLive ? j.monthsOnZuper : 0);
  const builtTogetherPath = built ? await insertGeneratedSlide(zip, "ppt/slides/slide26.xml", built) : null;

  const yearly = new Map<number, GrowthYear>();
  for (const m of j.months) {
    const y = m.start.getUTCFullYear();
    const e = yearly.get(y) ?? { label: String(y), jobs: 0, completed: 0, invoiced: 0, customersAdded: 0, partial: false };
    e.jobs += m.jobsCreated;
    e.completed += m.jobsCompleted;
    e.invoiced += m.invoiced;
    e.customersAdded += m.customersAdded;
    yearly.set(y, e);
  }
  const years = [...yearly.entries()].sort((a, b) => a[0] - b[0]);
  for (const [y, e] of years) {
    const startedMidYear = j.goLive != null && j.goLive.getUTCFullYear() === y && j.goLive.getUTCMonth() > 0;
    const unfinished = y === range.end.getUTCFullYear() && !(range.end.getUTCMonth() === 11 && range.end.getUTCDate() === 31);
    e.partial = startedMidYear || unfinished;
    if (unfinished) e.label = `${y} YTD`;
    else if (startedMidYear) e.label = `${y} (from ${fmtDate(j.goLive!).slice(0, 3)})`;
  }
  const scaling = scalingSlide(cctx, years.map(([, e]) => e), industry.label, j.uses.invoices);
  if (scaling) await insertGeneratedSlide(zip, "ppt/slides/slide28.xml", scaling);

  // Executive summary, placed right after the scope slide once every slide's call-outs exist.
  const topCalloutsPath = await insertGeneratedSlide(zip, scope, topCalloutsSlide(ctx, collectedCallouts(zip)));
  return { topCalloutsPath, builtTogetherPath, industry, monthsOnZuper: j.goLive ? j.monthsOnZuper : null, coverage };
}

function storyValue(m: { unit: string }, v: number): string {
  if (m.unit === "pct") return `${(v * 100).toFixed(0)}%`;
  if (m.unit === "money") return fmtMoneyCompact(v);
  if (m.unit === "days") return `${v.toFixed(1)} days`;
  return fmtInt(v);
}

/** The account's own reading on each metric an industry playbook can ask for. Thresholds match the rest of the deck. */
function industryReadings(d: {
  jobs: JobDeepDive;
  quotes: QuoteDeepDive;
  invoices: InvoiceDeepDive;
  accounts: AccountsDeepDive;
  delivery: SharedDeckData["delivery"];
  exec: ExecutionDeepDive;
  calls: CallSummary | undefined;
  workflowLive: number;
}): Partial<Record<MetricKey, MetricReading | null>> {
  const { jobs, quotes, invoices, accounts, delivery, exec, calls } = d;
  const trend = momentum(jobs.monthly.map((m) => ({ label: m.label, value: m.created })), 3, 30);
  const ot = delivery.onTime;
  const answer = calls && calls.inbound ? calls.inboundAnswered / calls.inbound : null;
  const topOrg = accounts.topOrganizationsByJobs[0];
  return {
    quoteAcceptance: quotes.sent >= 5 ? { value: pct0(quotes.conversionRate), note: `of ${fmtInt(quotes.sent)} sent quotes accepted (${fmtMoneyCompact(quotes.convertedValue)})`, tone: quotes.conversionRate < 0.3 ? "risk" : quotes.conversionRate >= 0.5 ? "win" : "watch" } : null,
    staleQuotes: quotes.sent >= 5 ? { value: fmtMoneyCompact(quotes.staleOpen.value), note: `${fmtInt(quotes.staleOpen.count)} quotes open 30+ days`, tone: quotes.staleOpen.count >= 10 ? "opportunity" : "watch" } : null,
    callAnswerRate: answer != null ? { value: pct0(answer), note: `of ${fmtInt(calls!.inbound)} inbound calls answered`, tone: answer < 0.8 ? "risk" : answer >= 0.9 ? "win" : "watch" } : null,
    missedCalls: calls && calls.inbound ? { value: fmtInt(calls.inboundMissed), note: `inbound calls missed or to voicemail (${pct0(calls.inboundMissed / calls.inbound)})`, tone: calls.inboundMissed >= 20 ? "opportunity" : "win" } : null,
    onTime: ot ? { value: pct0(ot.onTime / ot.eligible), note: `of ${fmtInt(ot.eligible)} jobs completed by their scheduled end`, tone: ot.onTime / ot.eligible < 0.5 ? "risk" : ot.onTime / ot.eligible >= 0.85 ? "win" : "watch" } : null,
    recurringShare: jobs.created
      ? (() => {
          // Maintenance-type work created one job at a time is the tell for a recurring-schedule opportunity.
          const maint = jobs.categories.filter((c) => /maint|preventa|\bpm\b|recurr|service plan|clean/i.test(c.name)).reduce((s, c) => s + c.created, 0);
          const maintShare = maint / jobs.created;
          return {
            value: pct0(jobs.recurringShare),
            note: jobs.recurringShare < 0.1 && maintShare >= 0.2 ? `from recurring schedules — yet ${pct0(maintShare)} of jobs are maintenance work, created one by one` : "of jobs come from recurring schedules",
            tone: jobs.recurringShare < 0.1 ? ("opportunity" as const) : jobs.recurringShare >= 0.4 ? ("win" as const) : ("watch" as const),
          };
        })()
      : null,
    collectionRate: invoices.invoiced ? { value: pct0(invoices.collected / invoices.invoiced), note: `of ${fmtMoneyCompact(invoices.invoiced)} invoiced is collected`, tone: invoices.collected / invoices.invoiced >= 0.9 ? "win" : invoices.collected / invoices.invoiced < 0.8 ? "risk" : "watch" } : null,
    daysToPay: invoices.medianDaysToPay != null ? { value: `${invoices.medianDaysToPay.toFixed(0)} days`, note: "median from invoice to payment", tone: invoices.medianDaysToPay <= 15 ? "win" : invoices.medianDaysToPay > 45 ? "risk" : "watch" } : null,
    onlinePayShare: invoices.paymentsTotal ? { value: pct0(invoices.onlineShare), note: `of ${fmtMoneyCompact(invoices.paymentsTotal)} received was paid online`, tone: invoices.onlineShare < 0.2 ? "opportunity" : invoices.onlineShare >= 0.5 ? "win" : "watch" } : null,
    workflowHealth: exec.available
      ? { value: `${pct0(1 - exec.failureRate)} success`, note: `of workflow runs that executed (${fmtInt(d.workflowLive)} live workflows)`, tone: exec.failureRate > 0.2 ? "risk" : exec.failureRate < 0.05 ? "win" : "watch" }
      : d.workflowLive
        ? { value: `${fmtInt(d.workflowLive)} live`, note: "workflows automating hand-offs", tone: "win" }
        : { value: "None", note: "no live automations", tone: "opportunity" },
    jobGrowth: trend?.change != null ? { value: `${trend.change >= 0 ? "+" : "−"}${pct0(Math.abs(trend.change))}`, note: `jobs created ${trend.recentLabel} vs ${trend.priorLabel}`, tone: trend.change >= 0.1 ? "win" : trend.change <= -0.1 ? "risk" : "watch" } : null,
    repeatCustomers: accounts.customers.total >= 20 ? { value: pct0(accounts.customers.repeatShare), note: "of customers have booked more than one job", tone: accounts.customers.repeatShare < 0.2 ? "opportunity" : "watch" } : null,
    cycleTime: jobs.medianDaysCreatedToComplete != null ? { value: `${jobs.medianDaysCreatedToComplete.toFixed(0)} days`, note: "median from job created to completed", tone: "watch" } : null,
    backlog: delivery.unscheduledBacklog != null ? { value: fmtInt(delivery.unscheduledBacklog), note: "jobs waiting to be scheduled right now", tone: delivery.unscheduledBacklog > 50 ? "risk" : "watch" } : null,
    organizations: topOrg && accounts.jobsWithOrganization ? { value: pct0(topOrg.jobs / accounts.jobsWithOrganization), note: `of organization jobs from ${topOrg.name}`, tone: topOrg.jobs / accounts.jobsWithOrganization > 0.4 ? "risk" : "watch" } : null,
  };
}
