import type JSZip from "jszip";
import type { DateRange } from "@/lib/zuper/modules";
import type { CoverageRow, JobServiceDelivery, ModuleAnalysis, PortalAndPay } from "@/lib/reports/catalogMetrics";
import { momentum, type Callout } from "@/lib/reports/callouts";
import { COLORS, CONTENT_W, CONTENT_X, ShapeWriter, fmtInt, fmtMoneyCompact, insertGeneratedSlide, run, truncate } from "./generatedSlide";
import type { MetricDefinition } from "./slideNotes";

// ---------------------------------------------------------------------------
// Slides for everything beyond the core modules: jobs service delivery & time
// on site, Customer Portal & Zuper Pay, Zuper Connect & CSR Agent, one slide
// per catalog module with data, an account-setup summary, and data coverage.
// Same visual system as moduleSlides.ts; numbers come straight from
// catalogMetrics, and every slide ranks its call-outs (see reports/callouts.ts).
// ---------------------------------------------------------------------------

const SERIES = ["FD5000", "2A78D6", "1BAF7A", "4A3AA7"];
const GOOD = "0CA30C";
const CRITICAL = "D03B3B";
const KPI_Y = 1300000;
const BODY_Y = 2260000;
const BODY_H = 3480000;
const GAP = 150000;
const HALF_W = (CONTENT_W - GAP) / 2;
const left = { x: CONTENT_X, y: BODY_Y, cx: HALF_W, cy: BODY_H };
const right = { x: CONTENT_X + HALF_W + GAP, y: BODY_Y, cx: HALF_W, cy: BODY_H };

const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
const fmtDate = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const period = (r: DateRange) => `${fmtDate(r.start)} – ${fmtDate(r.end)}`;
const compact = (xs: (string | number | null | false | undefined)[]) => xs.filter((x): x is string => typeof x === "string" && x.length > 0);
type MaybeCallout = Callout | null | undefined | false | 0 | "";
const co = (xs: MaybeCallout[]): Callout[] => xs.filter((x): x is Callout => !!x && typeof x === "object");
const tidy = (s: string) => s.replace(/_/g, " ");

interface Ctx {
  customerName: string;
  range: DateRange;
  syncLine: string;
}

function textCard(w: ShapeWriter, box: { x: number; y: number; cx: number; cy: number }, title: string, lines: string[]) {
  const inner = w.card(box.x, box.y, box.cx, box.cy, title);
  lines.slice(0, 7).forEach((l, i) => w.text(inner.x + 60000, inner.y + 60000 + i * 420000, inner.cx - 120000, 380000, run(truncate(l, 95), { sz: 1050, color: COLORS.ink })));
}

// ---- Jobs: service delivery ---------------------------------------------------------------------

export function jobServiceSlide(ctx: Ctx, s: JobServiceDelivery): ShapeWriter {
  const w = new ShapeWriter();
  w.header("Jobs — Service Delivery", `Jobs created ${period(ctx.range)}  ·  on-time by job category, billing follow-through, backlog`);
  const ot = s.onTime;
  const onTimeRate = ot ? ot.onTime / ot.eligible : null;
  const invRate = s.invoicing && s.invoicing.completed ? s.invoicing.invoiced / s.invoicing.completed : null;
  const cats = s.onTimeByCategory.filter((c) => c.eligible >= 5);
  const rate = (c: { onTime: number; eligible: number }) => c.onTime / c.eligible;
  const bestCat = [...cats].sort((a, b) => rate(b) - rate(a))[0];
  // The category with the most late completions — how late "late" really is.
  const lateCat = [...cats].filter((c) => c.late >= 5 && c.medianDaysLate != null).sort((a, b) => b.late - a.late)[0];
  w.kpis(KPI_Y, [
    { value: onTimeRate == null ? "—" : pct(onTimeRate), label: ot ? `Completed by scheduled end (${fmtInt(ot.eligible)} due)` : "On-time (no job deadlines)", alert: onTimeRate != null && onTimeRate < 0.5 },
    {
      value: lateCat?.medianDaysLate != null ? `${lateCat.medianDaysLate.toFixed(0)} days` : bestCat ? pct(rate(bestCat)) : "—",
      label: lateCat?.medianDaysLate != null ? `Median days late: ${truncate(lateCat.name, 18)}` : bestCat ? `On-time: ${truncate(bestCat.name, 22)}` : "On-time by category",
    },
    { value: ot ? fmtInt(ot.overdueOpen) : "—", label: "Past due & still open", alert: !!ot && ot.overdueOpen > 0 },
    { value: invRate == null ? "—" : pct(invRate), label: s.invoicing ? "Completed jobs with an invoice" : "Invoice link not on jobs", alert: invRate != null && invRate < 0.8 },
    { value: s.unscheduledBacklog == null ? "—" : fmtInt(s.unscheduledBacklog), label: "Unscheduled backlog (live)" },
  ]);

  const a = w.card(left.x, left.y, left.cx, left.cy, "ON-TIME VS LATE, BY JOB CATEGORY");
  if (cats.length) {
    w.chart(a.x, a.y, a.cx, a.cy, {
      kind: "stackedBar",
      categories: cats.map((c) => truncate(c.name, 24)),
      series: [
        { name: "On time", values: cats.map((c) => c.onTime), color: GOOD },
        { name: "Late", values: cats.map((c) => c.late), color: "F2994A" },
        { name: "Past due, still open", values: cats.map((c) => c.overdueOpen), color: CRITICAL },
      ],
      showValues: false,
    });
  } else
    w.empty(a, s.extraSynced || !s.jobsInPeriod ? "Jobs don't carry a scheduled end / due date, so on-time can't be measured" : "Re-sync from Zuper to include on-time and billing detail for jobs");

  const b = w.card(right.x, right.y, right.cx, right.cy, "ON-TIME VS LATE, BY DEADLINE MONTH");
  if (s.onTimeMonthly.some((m) => m.onTime || m.late)) {
    w.chart(b.x, b.y, b.cx, b.cy, {
      kind: "stackedColumn",
      categories: s.onTimeMonthly.map((m) => m.label),
      series: [
        { name: "On time", values: s.onTimeMonthly.map((m) => m.onTime), color: GOOD },
        { name: "Late or past due", values: s.onTimeMonthly.map((m) => m.late), color: CRITICAL },
      ],
      showValues: false,
    });
  } else w.empty(b, "No job deadlines in this period");

  const openHeavy = [...cats].sort((x, y) => y.overdueOpen - x.overdueOpen)[0];
  w.keyCallouts(
    co([
      openHeavy &&
        ot &&
        openHeavy.overdueOpen >= 10 && {
          tone: "risk",
          headline: `${fmtInt(openHeavy.overdueOpen)} ${openHeavy.name} jobs are past their scheduled date and still open`,
          detail: `${pct(openHeavy.overdueOpen / Math.max(ot.overdueOpen, 1))} of all past-due jobs — confirm whether they're live work or pipeline that should be closed or rescheduled.`,
          score: 70,
          area: "Service delivery",
        },
      lateCat &&
        lateCat.medianDaysLate != null && {
          tone: lateCat.medianDaysLate > 7 ? "risk" : "watch",
          headline: `${lateCat.name} jobs are marked complete a median ${lateCat.medianDaysLate.toFixed(0)} days after their scheduled end`,
          detail:
            lateCat.medianDaysLate > 7
              ? "either the work runs long or jobs aren't closed out in Zuper when finished — which one changes the fix."
              : "close to schedule; tighten close-out so completion dates reflect the real finish.",
          score: 64,
          area: "Service delivery",
        },
      bestCat &&
        cats.length > 1 && {
          tone: rate(bestCat) >= 0.8 ? "win" : "watch",
          headline: `${bestCat.name} jobs finish on time ${pct(rate(bestCat))} of the time`,
          detail: cats
            .filter((c) => c !== bestCat)
            .slice(0, 2)
            .map((c) => `${c.name} ${pct(rate(c))}`)
            .join(", ")
            .concat(" — categories behave differently, so set targets per category."),
          score: 55,
          area: "Service delivery",
        },
      invRate != null &&
        invRate < 0.8 &&
        (s.invoicing?.completed ?? 0) >= 20 && {
          tone: "risk",
          headline: `Only ${pct(invRate)} of completed jobs have an invoice attached`,
          detail: "either billing happens outside Zuper or finished work isn't being billed promptly — worth confirming.",
          score: 66,
          area: "Service delivery",
        },
      s.rating && {
        tone: s.rating.average >= 4.5 ? "win" : "watch",
        headline: `Customers rate jobs ${s.rating.average.toFixed(1)} / 5 on average`,
        detail: `across ${fmtInt(s.rating.rated)} rated jobs.`,
        score: 45,
        area: "Service delivery",
      },
      s.unscheduledBacklog != null &&
        s.unscheduledBacklog > 0 && {
          tone: "watch",
          headline: `${fmtInt(s.unscheduledBacklog)} jobs are waiting to be scheduled right now`,
          detail: "the live unscheduled queue in Zuper.",
          score: 36,
          area: "Service delivery",
        },
    ]),
    "Job deadlines and invoice links aren't recorded on this account's jobs."
  );
  w.footer(`Source: Zuper Jobs (${s.deadlineField ?? "deadline"}, job category, invoice link) & unscheduled jobs · jobs created in the period`);

  const metrics: MetricDefinition[] = [
    {
      label: "On-time completion",
      value: onTimeRate == null ? "—" : pct(onTimeRate, 1),
      definition: `Not-cancelled jobs whose ${s.deadlineField ?? "deadline"} falls in the period: completed on or before the deadline day ÷ (those completed + those still open after their deadline). Jobs not yet due are excluded. Uses the job's current deadline — rescheduled jobs are measured against the new date.`,
      source: "Zuper Jobs",
      evidence: ot ? "Observed activity" : "Insufficient data",
    },
    { label: "By category", definition: "Same rule, per job category. Categories that represent a sales or lead stage often stay open past their appointment date by design.", source: "Zuper Jobs", evidence: "Observed activity" },
    { label: "Median days late", value: lateCat?.medianDaysLate != null ? `${lateCat.medianDaysLate.toFixed(1)} days (${lateCat.name})` : "—", definition: "For jobs completed after their scheduled end: completion status time − scheduled end, median, per category.", source: "Zuper Jobs status history", evidence: "Observed activity" },
    { label: "Past due & still open", value: ot ? fmtInt(ot.overdueOpen) : "—", definition: "Jobs due in the period, past their deadline day, not completed or cancelled.", source: "Zuper Jobs", evidence: "Current state" },
    {
      label: "Completed jobs with an invoice",
      value: invRate == null ? "—" : pct(invRate, 1),
      definition: s.invoicing ? `Completed jobs created in the period whose ${s.invoicing.field} is set ÷ all completed jobs created in the period.` : "The job list doesn't include an invoice link for this account.",
      source: "Zuper Jobs",
      evidence: s.invoicing ? "Observed activity" : "Insufficient data",
    },
    { label: "Unscheduled backlog", value: s.unscheduledBacklog == null ? "—" : fmtInt(s.unscheduledBacklog), definition: "Zuper's live count of unscheduled jobs (all dates) at sync time.", source: "Zuper /jobs/unscheduled", evidence: "Current state" },
  ];
  w.notes = {
    purpose: "Whether jobs are delivered by their scheduled date and billed — split by job category, because a sales visit and a production job run on different clocks.",
    talkingPoints: ["Agree which category's on-time rate matters most to the customer and set a target for the next review."],
    metrics,
    caveats: compact([
      !s.extraSynced && s.jobsInPeriod > 0 && "This account hasn't been synced since the full job detail was added — run Sync from Zuper again, then re-download the deck.",
      "Deadlines are the job's current schedule; original promise dates aren't kept when jobs are rescheduled, which can flatter on-time rate.",
      ctx.syncLine,
    ]),
  };
  return w;
}

// ---- Jobs: time on site ---------------------------------------------------------------------

export function timeOnSiteSlide(ctx: Ctx, s: JobServiceDelivery): ShapeWriter | null {
  const t = s.timeOnSite;
  if (!t) return null;
  const w = new ShapeWriter();
  w.header("Jobs — Time Logged", `Job time logs clocked in ${period(ctx.range)}`);
  const perEntry = t.entries ? t.hours / t.entries : 0;
  w.kpis(KPI_Y, [
    { value: `${fmtInt(t.hours)} h`, label: "Hours logged on jobs" },
    { value: fmtInt(t.entries), label: "Time log entries" },
    { value: `${perEntry.toFixed(1)} h`, label: "Average per entry" },
    { value: fmtInt(t.people.length), label: "People logging time" },
    { value: fmtInt(t.longEntries), label: "Entries over 12 h (missed clock-out?)", alert: t.longEntries > 0 },
  ]);
  const a = w.card(left.x, left.y, left.cx, left.cy, "HOURS LOGGED BY PERSON");
  w.chart(a.x, a.y, a.cx, a.cy, { kind: "bar", categories: t.people.slice(0, 8).map((p) => truncate(p.name, 24)), series: [{ name: "Hours", values: t.people.slice(0, 8).map((p) => Math.round(p.hours)), color: SERIES[0] }] });
  const b = w.card(right.x, right.y, right.cx, right.cy, "ENTRIES BY PERSON");
  w.chart(b.x, b.y, b.cx, b.cy, { kind: "bar", categories: t.people.slice(0, 8).map((p) => truncate(p.name, 24)), series: [{ name: "Entries", values: t.people.slice(0, 8).map((p) => p.entries), color: SERIES[1] }] });
  const perJobsWeek = s.jobsInPeriod ? t.entries / s.jobsInPeriod : 0;
  w.keyCallouts(
    co([
      s.jobsInPeriod >= 50 &&
        perJobsWeek < 0.2 && {
          tone: "opportunity",
          headline: `Only ${fmtInt(t.entries)} time logs against ${fmtInt(s.jobsInPeriod)} jobs`,
          detail: "time tracking isn't part of the field routine yet — consistent clock-in on jobs unlocks labor cost per job and utilization.",
          score: 52,
          area: "Team",
        },
      t.longEntries > 0 && {
        tone: "watch",
        headline: `${fmtInt(t.longEntries)} time log${t.longEntries === 1 ? "" : "s"} ran over 12 hours`,
        detail: "usually a missed clock-out — these inflate logged hours; worth cleaning up before using the numbers.",
        score: 40,
        area: "Team",
      },
      t.people[0] && {
        tone: "watch",
        headline: `${t.people[0].name} logged the most time (${fmtInt(t.people[0].hours)} h)`,
        detail: `${fmtInt(t.people[0].entries)} entries.`,
        score: 20,
        area: "Team",
      },
    ]),
    `${fmtInt(t.hours)} hours logged across ${fmtInt(t.entries)} entries.`
  );
  w.footer("Source: Zuper job time logs (/jobs/timelog_summary) · time_spent in minutes, else clock-out − clock-in");
  w.notes = {
    purpose: "How much field time is being captured in Zuper — the basis for capacity, pricing and labor-cost conversations.",
    metrics: [
      { label: "Hours logged on jobs", value: `${fmtInt(t.hours)} h`, definition: "Sum of time_spent (minutes ÷ 60), or clock_out − clock_in where time_spent is blank, for logs clocked in during the period.", source: "Zuper /jobs/timelog_summary", evidence: "Observed activity" },
      { label: "Entries over 12 h", value: fmtInt(t.longEntries), definition: "Single logs longer than 12 hours.", source: "Zuper job time logs", evidence: "Observed activity" },
    ],
    caveats: ["The time-log list doesn't carry a job id, so hours can't be split by job or category.", "Time logs only cover jobs where people clock in; missing logs are a coverage gap, not zero effort.", ctx.syncLine],
  };
  return w;
}

// ---- Customer Portal & Zuper Pay -------------------------------------------------------------------

export function portalPaySlide(ctx: Ctx, p: PortalAndPay): ShapeWriter {
  const w = new ShapeWriter();
  w.header("Customer Portal & Zuper Pay", `Payments received ${period(ctx.range)}  ·  payment requests and portal access are current`);
  const onlineShare = p.online.total ? p.online.amount / p.online.total : 0;
  const pr = p.paymentRequests;
  const paidReqs = pr?.statuses.find((s) => /paid/i.test(s.name))?.count ?? 0;
  const notYet = "Not synced yet — re-sync";
  w.kpis(KPI_Y, [
    { value: pct(onlineShare), label: `Paid online (${fmtMoneyCompact(p.online.amount)} of ${fmtMoneyCompact(p.online.total)})`, alert: p.online.total > 0 && onlineShare < 0.2 },
    { value: pr ? fmtInt(pr.count) : "—", label: pr ? "Zuper Pay payment requests" : p.catalogSynced ? "No payment requests" : notYet },
    { value: pr ? `${fmtInt(paidReqs)} of ${fmtInt(pr.count)}` : "—", label: "Payment requests paid" },
    {
      value: p.portalPayments && p.portalPayments.count ? fmtMoneyCompact(p.portalPayments.amount) : "—",
      label: p.portalPayments?.count ? `Paid via Customer Portal (${fmtInt(p.portalPayments.count)})` : "No portal-sourced payments",
    },
    { value: p.portalOrgs ? `${fmtInt(p.portalOrgs.enabled)} / ${fmtInt(p.portalOrgs.total)}` : "—", label: p.portalOrgs ? "Organizations with portal access" : p.catalogSynced ? "Organizations not in use" : notYet },
  ]);
  const a = w.card(left.x, left.y, left.cx, left.cy, "PAYMENTS BY WHERE THEY WERE RECORDED");
  if (p.paymentSources.length)
    w.chart(a.x, a.y, a.cx, a.cy, { kind: "bar", categories: p.paymentSources.map((s) => truncate(tidy(s.name), 24)), series: [{ name: "Amount", values: p.paymentSources.map((s) => Math.round(s.amount)), color: SERIES[0] }], numberFormat: "$#,##0" });
  else w.empty(a, "Payments don't record where they were made");
  const b = w.card(right.x, right.y, right.cx, right.cy, "PAYMENT REQUESTS BY STATUS");
  if (pr?.statuses.length) w.chart(b.x, b.y, b.cx, b.cy, { kind: "bar", categories: pr.statuses.map((s) => truncate(tidy(s.name), 24)), series: [{ name: "Requests", values: pr.statuses.map((s) => s.count), color: SERIES[1] }] });
  else w.empty(b, pr ? "Payment requests have no status recorded" : "No Zuper Pay payment requests on the account");

  const backOffice = p.paymentSources.find((s) => /back.?office|office|admin/i.test(s.name));
  w.keyCallouts(
    co([
      p.online.total > 0 &&
        onlineShare < 0.3 && {
          tone: "opportunity",
          headline: `${pct(1 - onlineShare)} of payments (${fmtMoneyCompact(p.online.total - p.online.amount)}) were collected offline`,
          detail: "Zuper Pay payment links, card-on-file and ACH move that money online and into the same record as the invoice.",
          score: 64,
          area: "Zuper Pay",
        },
      p.online.total > 0 &&
        onlineShare >= 0.5 && {
          tone: "win",
          headline: `${pct(onlineShare)} of payments are already collected online`,
          detail: "a strong digital-payments adoption story.",
          score: 50,
          area: "Zuper Pay",
        },
      backOffice &&
        p.online.total > 0 &&
        backOffice.amount / p.online.total > 0.7 && {
          tone: "watch",
          headline: `${pct(backOffice.amount / p.online.total)} of payments are keyed in by the back office`,
          detail: "customers aren't paying themselves yet — self-serve payment is the Customer Portal / Zuper Pay conversation.",
          score: 48,
          area: "Zuper Pay",
        },
      pr &&
        pr.count >= 3 && {
          tone: "watch",
          headline: `${fmtInt(paidReqs)} of ${fmtInt(pr.count)} Zuper Pay payment requests have been paid`,
          detail: pr.amount ? `${fmtMoneyCompact(pr.amount)} requested in total — payment links are live but lightly used.` : "payment links are live but lightly used.",
          score: 42,
          area: "Zuper Pay",
        },
      p.portalOrgs &&
        p.portalOrgs.total > 0 &&
        p.portalOrgs.enabled / p.portalOrgs.total < 0.5 && {
          tone: "opportunity",
          headline: `Portal access is on for ${fmtInt(p.portalOrgs.enabled)} of ${fmtInt(p.portalOrgs.total)} organizations`,
          detail: "turning it on lets B2B customers see jobs and invoices and pay without calling in.",
          score: 50,
          area: "Customer Portal",
        },
    ]),
    p.online.total ? `${pct(onlineShare)} of ${fmtMoneyCompact(p.online.total)} received was paid online.` : "No payments were received in this period."
  );
  w.footer("Source: Zuper Payments (payment mode, source), Payment requests, Organizations (is_portal_enabled)");
  w.notes = {
    purpose: "How customers pay and self-serve: online payment share, where payments are recorded, Zuper Pay payment requests and Customer Portal access.",
    metrics: [
      { label: "Paid online", value: pct(onlineShare, 1), definition: "Payments in the period with payment_mode_type ONLINE ÷ all payments in the period, by amount.", source: "Zuper Payments", evidence: "Observed activity" },
      { label: "Payments by where they were recorded", definition: "Payment source as Zuper reports it (e.g. BACK OFFICE = entered by staff, EXTERNAL = from an outside channel/integration).", source: "Zuper Payments (source)", evidence: "Observed activity" },
      { label: "Payment requests", value: pr ? fmtInt(pr.count) : "—", definition: "Zuper Pay payment requests/links on the account (all-time), by status.", source: "Zuper /payments/payment_request", evidence: "Current state" },
      { label: "Organizations with portal access", value: p.portalOrgs ? `${p.portalOrgs.enabled} / ${p.portalOrgs.total}` : "—", definition: "Organizations with is_portal_enabled = true.", source: "Zuper Organizations", evidence: "Current state" },
    ],
    caveats: ["Portal logins and page views aren't exposed by the API — only enablement and portal-sourced payments.", "ONLINE payment mode is the closest proxy for Zuper Pay; card payments processed elsewhere may also be recorded as online.", ctx.syncLine],
  };
  return w;
}

// ---- Zuper Connect & CSR Agent ---------------------------------------------------------------------

export function connectSlide(ctx: Ctx, calls: ModuleAnalysis | undefined, sms: ModuleAnalysis | undefined, coverage: CoverageRow[]): ShapeWriter {
  const w = new ShapeWriter();
  w.header("Zuper Connect & CSR Agent", `Business calls and texts through Zuper Connect  ·  calls ${period(ctx.range)}`);
  const callCov = coverage.find((c) => c.module === "connect_calls");
  const c = calls?.calls;
  if (!calls || !c) {
    const box = w.card(CONTENT_X, KPI_Y, CONTENT_W, 4480000, "CONNECT DATA");
    const why = callCov ? `${callCov.message ?? callCov.status}` : "Not synced yet";
    w.empty(box, `No Zuper Connect call data for this account (${why}). If they use Connect, check it's enabled and the API key has access; if not, Connect + CSR Agent is a clear opportunity.`);
    w.keyCallouts(
      co([{ tone: "opportunity", headline: "No calls or texts are flowing through Zuper Connect", detail: "Connect puts every customer call and text on the job record; CSR Agent answers the overflow.", score: 40, area: "Zuper Connect" }]),
      ""
    );
    w.footer("Source: Zuper Connect (telephony calls & SMS conversations)");
    w.notes = {
      purpose: "Customer communication through Zuper Connect, including calls the AI CSR Agent handles.",
      talkingPoints: ["Ask how inbound calls are handled after hours and during surges — missed calls are missed jobs. This is the CSR Agent conversation."],
      caveats: [callCov ? `Connect sync status: ${callCov.status}${callCov.message ? ` — ${callCov.message}` : ""}.` : "Connect wasn't synced.", "AI call summaries and CSR Agent settings aren't exposed by the API."],
    };
    return w;
  }
  const answerRate = c.inbound ? c.inboundAnswered / c.inbound : null;
  const openThreads = sms ? sms.breakdowns.find((b) => /done/i.test(b.field))?.values.find((v) => v.name === "false")?.count : undefined;
  w.kpis(KPI_Y, [
    { value: fmtInt(c.inPeriod), label: `Calls in the period (${fmtInt(c.inbound)} in / ${fmtInt(c.outbound)} out)` },
    { value: answerRate == null ? "—" : pct(answerRate), label: "Inbound calls answered", alert: answerRate != null && answerRate < 0.85 },
    { value: fmtInt(c.inboundMissed), label: "Inbound calls missed / voicemail", alert: c.inboundMissed > 0 },
    { value: c.avgAnswerSec == null ? "—" : `${c.avgAnswerSec.toFixed(0)} s`, label: "Average time to answer" },
    { value: sms ? fmtInt(sms.total) : "—", label: sms ? `Text conversations${openThreads != null ? ` (${fmtInt(openThreads)} open)` : ""}` : "No text conversations" },
  ]);
  const a = w.card(left.x, left.y, left.cx, left.cy, "CALLS PER MONTH");
  if (c.monthly.some((m) => m.count)) w.chart(a.x, a.y, a.cx, a.cy, { kind: "column", categories: c.monthly.map((m) => m.label), series: [{ name: "Calls", values: c.monthly.map((m) => m.count), color: SERIES[0] }] });
  else w.empty(a, "No calls in this period");
  const dim = calls.breakdowns.find((b) => /status/i.test(b.field)) ?? calls.breakdowns[0];
  const b = w.card(right.x, right.y, right.cx, right.cy, dim ? `CALLS BY ${dim.label.toUpperCase()} (ALL SYNCED)` : "TEXT CONVERSATIONS");
  if (dim) w.chart(b.x, b.y, b.cx, b.cy, { kind: "bar", categories: dim.values.map((v) => truncate(tidy(v.name), 24)), series: [{ name: "Calls", values: dim.values.map((v) => v.count), color: SERIES[1] }] });
  else w.empty(b, sms ? `${fmtInt(sms.total)} text conversations synced` : "No breakdown available");

  const trend = momentum(c.monthly.map((m) => ({ label: m.label, value: m.count })), 3, 50);
  w.keyCallouts(
    co([
      c.inboundMissed >= 10 && {
        tone: "opportunity",
        headline: `${fmtInt(c.inboundMissed)} inbound calls went unanswered or to voicemail`,
        detail: `${answerRate != null ? `${pct(1 - answerRate)} of inbound calls` : "inbound calls"} — each is a potential lost job; CSR Agent answers overflow and after-hours calls and books the work.`,
        score: 78,
        area: "Zuper Connect",
      },
      c.avgAnswerSec != null &&
        c.avgAnswerSec <= 15 && {
          tone: "win",
          headline: `Answered calls are picked up in ${c.avgAnswerSec.toFixed(0)} seconds on average`,
          detail: "a fast front desk when someone is available.",
          score: 38,
          area: "Zuper Connect",
        },
      trend?.change != null &&
        Math.abs(trend.change) >= 0.15 && {
          tone: trend.change > 0 ? "win" : "watch",
          headline: `Call volume ${trend.change > 0 ? "up" : "down"} ${pct(Math.abs(trend.change))} — ${fmtInt(trend.recent)} calls in ${trend.recentLabel}`,
          detail: `vs ${fmtInt(trend.prior)} in ${trend.priorLabel}${trend.change > 0 ? "; more customer conversations are running through Connect" : ""}.`,
          score: 46,
          area: "Zuper Connect",
        },
      c.recordedShare != null &&
        c.recordedShare >= 0.9 && {
          tone: "win",
          headline: `${pct(c.recordedShare)} of calls are recorded`,
          detail: "every conversation is on the record for training, disputes and AI call summaries.",
          score: 30,
          area: "Zuper Connect",
        },
    ]),
    `${fmtInt(c.inPeriod)} calls in the period.`
  );
  w.footer(`Source: Zuper Connect telephony calls & SMS conversations${calls.coverage.truncated ? " · capped sample" : ""} · direction, answered time, status`);
  w.notes = {
    purpose: "Customer communication through Zuper Connect — how many calls come in, how many are answered, and the missed-call opportunity for CSR Agent.",
    talkingPoints: ["Missed and voicemail calls are lost jobs — use the missed count to size the CSR Agent opportunity."],
    metrics: [
      { label: "Calls in the period", value: fmtInt(c.inPeriod), definition: "Call records whose created_at falls in the period; in/out by direction INCOMING / OUTGOING.", source: "Zuper Connect /telephony/calls", evidence: "Observed activity" },
      { label: "Inbound calls answered", value: answerRate == null ? "—" : pct(answerRate, 1), definition: "Incoming calls with call_metric.answered_at set ÷ all incoming calls in the period.", source: "Zuper Connect", evidence: "Observed activity" },
      { label: "Inbound missed / voicemail", value: fmtInt(c.inboundMissed), definition: "Incoming calls with no answered time, or status MISSED / VOICEMAIL.", source: "Zuper Connect", evidence: "Observed activity" },
      { label: "Average time to answer", value: c.avgAnswerSec == null ? "—" : `${c.avgAnswerSec.toFixed(1)} s`, definition: "Mean call_metric.time_to_answer across answered calls in the period.", source: "Zuper Connect", evidence: "Observed activity" },
      ...(sms ? [{ label: "Text conversations", value: fmtInt(sms.total), definition: "Conversation threads; open = is_done false.", source: "Zuper Connect /telephony/message/conversations", evidence: "Current state" as const }] : []),
    ],
    caveats: compact([
      calls.coverage.truncated && `Calls were capped at ${fmtInt(calls.total)} of ${fmtInt(calls.coverage.totalRecords ?? calls.total)} — period counts may be low; re-sync after the cap was raised.`,
      "AI call summaries and CSR Agent settings aren't exposed by the API.",
      ctx.syncLine,
    ]),
  };
  return w;
}

// ---- One slide per catalog module --------------------------------------------------------------------

/** Configuration lists that say little on their own — summarized together on one "Account setup" slide. */
export const SETUP_MODULES = new Set(["job_categories", "product_categories", "business_units", "teams", "proposal_templates", "packages", "vendors", "subcontractors", "pricelists", "product_groups"]);

export function moduleSlide(ctx: Ctx, m: ModuleAnalysis, context: { quotesInPeriod: number; jobsInPeriod: number }): ShapeWriter {
  const w = new ShapeWriter();
  const dated = m.inPeriod != null;
  w.header(m.label, `${m.area}  ·  ${dated ? `created ${period(ctx.range)} vs all-time` : "current snapshot"}`);
  const tiles: { value: string; label: string; alert?: boolean }[] = [{ value: fmtInt(m.total), label: m.coverage.truncated ? "Records (capped)" : "Records (all-time)" }];
  if (dated) tiles.push({ value: fmtInt(m.inPeriod!), label: "Created in the period" });
  if (m.amount) {
    const periodAmount = dated && m.amount.inPeriod > 0;
    tiles.push({ value: fmtMoneyCompact(periodAmount ? m.amount.inPeriod : m.amount.total), label: `${m.amount.label} (${periodAmount ? "period" : "all-time"})` });
  }
  for (const h of m.highlights) if (tiles.length < 5) tiles.push({ value: h.value, label: h.label, alert: h.alert });
  const top = m.breakdowns[0];
  if (tiles.length < 5 && top) tiles.push({ value: pct(top.values[0].count / Math.max(top.filled, 1)), label: truncate(`${tidy(top.values[0].name)} (${top.label.toLowerCase()})`, 40) });
  w.kpis(KPI_Y, tiles);

  const a = w.card(left.x, left.y, left.cx, left.cy, dated ? "CREATED PER MONTH" : top ? `BY ${top.label.toUpperCase()}` : "DETAIL");
  if (dated && m.monthly.some((x) => x.count)) w.chart(a.x, a.y, a.cx, a.cy, { kind: "column", categories: m.monthly.map((x) => x.label), series: [{ name: m.label, values: m.monthly.map((x) => x.count), color: SERIES[0] }] });
  else if (!dated && top) w.chart(a.x, a.y, a.cx, a.cy, { kind: "bar", categories: top.values.map((v) => truncate(tidy(v.name), 26)), series: [{ name: "Records", values: top.values.map((v) => v.count), color: SERIES[0] }] });
  else w.empty(a, dated ? "None created in this period" : m.describe);

  const second = dated ? top : m.breakdowns[1];
  if (second) {
    const b = w.card(right.x, right.y, right.cx, right.cy, `BY ${second.label.toUpperCase()}`);
    w.chart(b.x, b.y, b.cx, b.cy, { kind: "bar", categories: second.values.map((v) => truncate(tidy(v.name), 26)), series: [{ name: "Records", values: second.values.map((v) => v.count), color: SERIES[1] }] });
  } else textCard(w, right, "ABOUT THIS MODULE", [m.describe, ...m.highlights.map((h) => `${h.label}: ${h.value}`)]);

  // ---- call-outs: usage status, trend, and module-specific meaning -------------------------------
  const singleStatus = m.singleStatus;
  const trend = dated ? momentum(m.monthly.map((x) => ({ label: x.label, value: x.count })), 3, 20) : null;
  const notUsed = dated && m.inPeriod === 0 && m.total > 0;
  const perJob = context.jobsInPeriod && dated && m.inPeriod ? m.inPeriod / context.jobsInPeriod : null;
  const byZuper = m.total ? m.createdByZuper / m.total : 0;
  w.keyCallouts(
    co([
      notUsed && {
        tone: "watch",
        headline: `No new ${m.label.toLowerCase()} this period (${fmtInt(m.total)} on the account)`,
        detail:
          [singleStatus && `all "${tidy(singleStatus.value).toLowerCase()}"`, byZuper >= 0.8 && "created by Zuper at onboarding"].filter(Boolean).join(", ") +
          (singleStatus || byZuper >= 0.8 ? " — set up, not yet in real use." : "set up but not in active use — ask whether it should be."),
        score: 44,
        area: m.area,
      },
      !notUsed &&
        singleStatus &&
        m.total >= 5 && {
          tone: "watch",
          headline: `All ${fmtInt(m.total)} ${m.label.toLowerCase()} are "${tidy(singleStatus.value).toLowerCase()}"`,
          detail: "nothing has moved past this status — check the process is being followed in Zuper.",
          score: 42,
          area: m.area,
        },
      !notUsed &&
        byZuper >= 0.5 &&
        m.total >= 5 && {
          tone: "watch",
          headline: `${pct(byZuper)} of ${m.label.toLowerCase()} were created by Zuper staff`,
          detail: "likely onboarding or test records — exclude them before drawing conclusions.",
          score: 40,
          area: m.area,
        },
      m.key === "proposals" &&
        context.quotesInPeriod > 0 &&
        m.inPeriod != null && {
          tone: m.inPeriod / context.quotesInPeriod >= 0.5 ? "win" : "opportunity",
          headline: `${pct(Math.min(1, m.inPeriod / context.quotesInPeriod))} of quotes are sent as proposals (${fmtInt(m.inPeriod)})`,
          detail: m.inPeriod / context.quotesInPeriod >= 0.5 ? "the team has adopted proposals as the standard way to quote." : "Good-Better-Best proposals typically lift average ticket — worth expanding.",
          score: 46,
          area: m.area,
        },
      (m.key === "notes" || m.key === "attachments") &&
        perJob != null &&
        perJob > 0 && {
          tone: "win",
          headline: `${perJob.toFixed(1)} ${m.key === "notes" ? "notes" : "files"} per job this period`,
          detail: m.key === "notes" ? "the team documents work in Zuper — a strong system-of-record habit." : "photos and documents live on the job record.",
          score: 34,
          area: m.area,
        },
      trend?.change != null &&
        Math.abs(trend.change) >= 0.25 && {
          tone: trend.change > 0 ? "win" : "watch",
          headline: `${m.label} ${trend.change > 0 ? "up" : "down"} ${pct(Math.abs(trend.change))} in ${trend.recentLabel}`,
          detail: `${fmtInt(trend.recent)} vs ${fmtInt(trend.prior)} in ${trend.priorLabel}.`,
          score: 36,
          area: m.area,
        },
      ...m.highlights
        .filter((h) => h.alert)
        .map((h) => ({ tone: "risk" as const, headline: `${h.label}: ${h.value}`, detail: h.definition.replace(/\.$/, "") + ".", score: 56, area: m.area })),
      !notUsed &&
        top &&
        !singleStatus && {
          tone: "watch",
          headline: `Most ${m.label.toLowerCase()} are "${tidy(top.values[0].name).toLowerCase()}" (${pct(top.values[0].count / Math.max(top.filled, 1))})`,
          detail: `by ${top.label.toLowerCase()}: ${top.values
            .slice(1, 3)
            .map((v) => `${tidy(v.name).toLowerCase()} ${fmtInt(v.count)}`)
            .join(", ")}.`,
          score: 22,
          area: m.area,
        },
    ]),
    m.describe
  );
  w.footer(`Source: Zuper ${m.coverage.endpoint} · ${m.coverage.truncated ? "capped sample · " : ""}synced ${fmtDate(m.coverage.fetchedAt)}`);

  w.notes = {
    purpose: m.describe,
    metrics: [
      { label: "Records", value: fmtInt(m.total), definition: m.coverage.truncated ? `First ${fmtInt(m.total)} records returned (capped; Zuper reports ${m.coverage.totalRecords != null ? fmtInt(m.coverage.totalRecords) : "more"}).` : "Every record the endpoint returned at sync time.", source: `Zuper ${m.coverage.endpoint}`, evidence: "Current state" },
      ...(dated ? [{ label: "Created in the period", value: fmtInt(m.inPeriod!), definition: "Records whose created/primary date falls in the report period.", source: `Zuper ${m.coverage.endpoint}`, evidence: "Observed activity" as const }] : []),
      ...(m.amount ? [{ label: m.amount.label, value: fmtMoneyCompact(dated ? m.amount.inPeriod : m.amount.total), definition: `Sum of field "${m.amount.field}"${dated ? " for records created in the period" : " across all records"} (present on ${fmtInt(m.amount.filled)} records). All-time total: ${fmtMoneyCompact(m.amount.total)}.`, source: `Zuper ${m.coverage.endpoint}`, evidence: "Observed activity" as const }] : []),
      ...m.breakdowns.map((bd) => ({ label: `By ${bd.label.toLowerCase()}`, definition: `Count of records by field "${bd.field}" (present on ${fmtInt(bd.filled)} of ${fmtInt(m.total)} records).`, source: `Zuper ${m.coverage.endpoint}`, evidence: "Current state" as const })),
      ...m.highlights.map((h) => ({ label: h.label, value: h.value, definition: h.definition, source: `Zuper ${m.coverage.endpoint}`, evidence: "Current state" as const })),
    ],
    caveats: compact([
      "Field names come from Zuper's API reference and the data itself; spot-check a record in Zuper before quoting an exact figure.",
      m.coverage.truncated && `Capped at ${fmtInt(m.total)} records — totals are a floor.`,
    ]),
    editBeforePresenting: ["Delete this slide if the module isn't relevant to this customer's review."],
  };
  return w;
}

// ---- Account setup summary ----------------------------------------------------------------------------

export function setupSlide(ctx: Ctx, mods: ModuleAnalysis[]): ShapeWriter | null {
  if (!mods.length) return null;
  const w = new ShapeWriter();
  w.header("How the Account Is Set Up in Zuper", `${ctx.customerName}  ·  configuration as of the last sync`);
  const y0 = 1300000;
  const h = 4450000;
  w.rect(CONTENT_X, y0, CONTENT_W, h, COLORS.white, { radius: 3000, border: COLORS.border });
  const cols = [
    { label: "SET UP", x: 0.02, w: 0.24 },
    { label: "COUNT", x: 0.26, w: 0.08 },
    { label: "EXAMPLES", x: 0.34, w: 0.64 },
  ];
  cols.forEach((c) => w.text(CONTENT_X + CONTENT_W * c.x, y0 + 120000, CONTENT_W * c.w, 220000, run(c.label, { sz: 800, color: COLORS.faint, bold: true }), { wrap: "none" }));
  const rowH = Math.min(380000, (h - 480000) / mods.length);
  mods.forEach((m, i) => {
    const y = y0 + 400000 + i * rowH;
    if (i % 2 === 0) w.rect(CONTENT_X + 60000, y - 20000, CONTENT_W - 120000, rowH, "F7F7F5");
    const cells = [
      run(m.label, { sz: 950, color: COLORS.ink, bold: true }),
      run(fmtInt(m.total), { sz: 950, color: COLORS.ink }),
      run(truncate(m.names.join(" · ") || "—", 110), { sz: 850, color: COLORS.muted }),
    ];
    cols.forEach((c, j) => w.text(CONTENT_X + CONTENT_W * c.x, y, CONTENT_W * c.w - 60000, rowH - 30000, cells[j], { anchor: "ctr" }));
  });
  const jobCats = mods.find((m) => m.key === "job_categories");
  const templates = mods.find((m) => m.key === "proposal_templates");
  w.keyCallouts(
    co([
      jobCats && {
        tone: "watch",
        headline: `${fmtInt(jobCats.total)} job categories drive how work is tracked`,
        detail: `${jobCats.names.slice(0, 4).join(", ")} — every job-level metric in this deck is split by these.`,
        score: 24,
        area: "Setup",
      },
      templates &&
        templates.total > 0 && {
          tone: "win",
          headline: `${fmtInt(templates.total)} proposal templates are configured`,
          detail: "quotes go out consistently branded and structured.",
          score: 26,
          area: "Setup",
        },
    ]),
    "Configuration that shapes how the account's data is organized."
  );
  w.footer("Source: Zuper configuration endpoints (categories, teams, templates, packages, vendors, business units) · current state");
  w.notes = {
    purpose: "The building blocks of the account's configuration — useful context, and a quick check that setup matches how the customer actually works.",
    talkingPoints: ["Ask whether these categories, teams and templates still match how the business runs — stale setup makes every report less accurate."],
    caveats: [ctx.syncLine],
    editBeforePresenting: ["Optional slide — hide it for an executive audience."],
  };
  return w;
}

// ---- Data coverage -------------------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  ok: "Data synced",
  empty: "In API — no records",
  not_available: "Not enabled / no access",
  error: "Error",
  not_in_api: "Not in the API",
  skipped: "Skipped",
};

export function coverageSlides(ctx: Ctx, rows: CoverageRow[]): ShapeWriter[] {
  const withData = rows.filter((r) => r.status === "ok").sort((a, b) => b.recordCount - a.recordCount);
  const byStatus = (s: string) => rows.filter((r) => r.status === s).map((r) => r.label);
  const perSlide = 15;
  const pages = Math.max(1, Math.ceil(withData.length / perSlide));
  const out: ShapeWriter[] = [];
  for (let p = 0; p < pages; p++) {
    const slice = withData.slice(p * perSlide, (p + 1) * perSlide);
    const w = new ShapeWriter();
    w.header(
      `Data Coverage${pages > 1 ? ` (${p + 1} of ${pages})` : ""}`,
      rows.length ? `${withData.length} of ${rows.length} Zuper modules returned data for ${ctx.customerName}` : "Not recorded yet — run Sync from Zuper to capture coverage for every module"
    );
    const y0 = 1300000;
    const tableW = CONTENT_W * 0.6;
    const h = 4450000;
    w.rect(CONTENT_X, y0, tableW, h, COLORS.white, { radius: 3000, border: COLORS.border });
    const cols = [
      { label: "MODULE WITH DATA", x: 0.03, w: 0.5 },
      { label: "AREA", x: 0.53, w: 0.3 },
      { label: "RECORDS", x: 0.83, w: 0.15 },
    ];
    cols.forEach((c) => w.text(CONTENT_X + tableW * c.x, y0 + 120000, tableW * c.w, 220000, run(c.label, { sz: 800, color: COLORS.faint, bold: true }), { wrap: "none" }));
    const rowH = (h - 480000) / perSlide;
    slice.forEach((r, i) => {
      const y = y0 + 400000 + i * rowH;
      if (i % 2 === 0) w.rect(CONTENT_X + 60000, y - 20000, tableW - 120000, rowH, "F7F7F5");
      const cells = [
        run(truncate(r.label, 34), { sz: 900, color: COLORS.ink, bold: true }),
        run(r.area, { sz: 820, color: COLORS.muted }),
        run(`${fmtInt(r.recordCount)}${r.truncated ? "+" : ""}`, { sz: 900, color: COLORS.ink }),
      ];
      cols.forEach((c, j) => w.text(CONTENT_X + tableW * c.x, y, tableW * c.w - 40000, rowH - 30000, cells[j], { anchor: "ctr" }));
    });
    if (p === 0) {
      const sx = CONTENT_X + tableW + 150000;
      const sw = CONTENT_W - tableW - 150000;
      const groups: [string, string[], string][] = [
        ["NOT ENABLED / NO ACCESS", byStatus("not_available"), COLORS.alert],
        ["IN THE API, NO RECORDS", byStatus("empty"), COLORS.muted],
        ["NOT EXPOSED BY THE API", byStatus("not_in_api"), COLORS.muted],
        ["SYNC ERRORS", byStatus("error"), COLORS.alert],
      ];
      let gy = y0;
      for (const [title, list, color] of groups) {
        if (!list.length) continue;
        const text = truncate(list.join(" · "), 230);
        const gh = 330000 + Math.ceil(text.length / 48) * 170000;
        w.rect(sx, gy, sw, gh, COLORS.white, { radius: 4000, border: COLORS.border });
        w.text(sx + 140000, gy + 90000, sw - 280000, 200000, run(`${title} (${list.length})`, { sz: 800, color, bold: true }), { wrap: "none" });
        w.text(sx + 140000, gy + 300000, sw - 280000, gh - 330000, run(text, { sz: 820, color: COLORS.ink }));
        gy += gh + 100000;
      }
    }
    w.keyCallouts(
      p === 0
        ? co([
            {
              tone: "watch",
              headline: `${withData.length} Zuper modules returned data for this deck`,
              detail: `${byStatus("not_in_api").length} areas (e.g. Report Builder, Fleet) aren't exposed by Zuper's API — confirm their use with the customer rather than assuming non-use.`,
              score: 10,
              area: "Coverage",
            },
            byStatus("error").length > 0 && {
              tone: "risk",
              headline: `${byStatus("error").length} module${byStatus("error").length === 1 ? "" : "s"} failed to sync`,
              detail: `${byStatus("error").join(", ")} — re-sync before relying on them.`,
              score: 12,
              area: "Coverage",
            },
          ])
        : [],
      "Continued."
    );
    w.footer("Source: every list endpoint in Zuper's API reference, requested with this account's key at sync time");
    w.notes = {
      purpose: "Exactly what data this deck is built on: which Zuper modules returned data, which were empty, which aren't enabled, and which aren't exposed by the API at all.",
      callouts: rows.filter((r) => r.status === "error").map((r) => `${r.label}: sync error (${r.message ?? "unknown"}) — re-sync before relying on it.`),
      metrics: [
        { label: "Status", definition: "Data synced = records returned; In API, no records = endpoint worked but the account has none; Not enabled / no access = 401/403/404 for this key; Not exposed by the API = the product has no account-API endpoint.", source: "Sync results", evidence: "Current state" },
        { label: "Records", definition: "Records stored from that module ('+' = capped; Zuper reported more).", source: "Sync results", evidence: "Current state" },
      ],
      caveats: ["An empty or unavailable module is not proof the customer doesn't use that feature — permissions and plan limits also cause it (SPEC §14.3).", ctx.syncLine],
      editBeforePresenting: ["This slide is for the CSM's preparation — hide it before presenting if the customer doesn't need it."],
    };
    out.push(w);
  }
  return out;
}

/** Inserts slides in order after `after`; returns the last inserted slide path. */
export async function insertChain(zip: JSZip, after: string, slides: (ShapeWriter | null)[]): Promise<string> {
  let cur = after;
  for (const s of slides) if (s) cur = await insertGeneratedSlide(zip, cur, s);
  return cur;
}

export { STATUS_LABEL };
